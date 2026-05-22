/**
 * 顧客マスタ ⇄ callcenter-ai-system 同期サービス
 *
 *   pullFromCallcenter() : callcenter の全企業を取得 → fax-crm.customers へ upsert (肉付けマージ)
 *     マッチング優先順位: external_callcenter_id → fax_number → phone_number → 新規作成
 *
 *   pushCustomerToCallcenter(customer): 1顧客を callcenter に作成 or 更新
 *     - external_callcenter_id があれば PUT
 *     - 無ければ POST → 戻り値の id を external_callcenter_id として保存
 *     - 失敗時は fire-and-forget で console.error のみ (顧客保存は止めない想定)
 *
 * 注: callcenter の companies スキーマには fax_number 列が無いため、
 *     fax 番号は comment / address に追記する形で持ち込む (任意)
 */
const { getPool, isConfigured: dbConfigured } = require('../../config/db');
const cc = require('./callcenterClient');

function normPhone(s) {
  if (!s) return null;
  // 改行・空白除去 + 32文字 (DB列上限) に丸める
  return String(s).replace(/[\s\r\n]/g, '').slice(0, 32) || null;
}

// 各カラムの DB 上限に合わせて clip。 callcenter が長い値を持ってきた場合の保険
function clip(s, maxLen) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

// 都道府県47件 (北海道 / 東京都 / 大阪府 / 京都府 / 43県)
const PREFECTURES = [
  '北海道',
  '青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県',
  '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県',
  '徳島県','香川県','愛媛県','高知県',
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

/**
 * 住所文字列から都道府県名を抽出
 *   "山形県米沢市東..." → "山形県"
 *   "東京都新宿区..."   → "東京都"
 *   "北海道札幌市..."   → "北海道"
 *   "東北" などの広域名や住所無しなら null (callcenter の region フィールド由来は採用しない)
 */
function extractPrefecture(address) {
  if (!address) return null;
  const s = String(address).trim();
  if (!s) return null;
  // 47都道府県を順次チェック
  for (const pref of PREFECTURES) {
    if (s.startsWith(pref) || s.includes(pref)) return pref;
  }
  // 汎用パターン: 最初の "XX都/道/府/県" を抽出 (補助、 都道府県名に登録されていない異字体対応)
  const m = s.match(/^([^\s\d]+?[都道府県])/);
  if (m && m[1].length <= 6) return m[1];
  return null;
}

/**
 * 既存 customer を見つける (external_callcenter_id → fax → phone の順)
 */
async function findExistingCustomer(conn, { external_id, fax_number, phone_number }) {
  if (external_id) {
    const [rows] = await conn.query(
      'SELECT id, company_name, fax_number, phone_number FROM customers WHERE external_callcenter_id = ? LIMIT 1',
      [external_id]
    );
    if (rows[0]) return { ...rows[0], matchedBy: 'external_id' };
  }
  const faxNorm = normPhone(fax_number);
  if (faxNorm) {
    const [rows] = await conn.query(
      `SELECT id, company_name, fax_number, phone_number FROM customers
        WHERE REGEXP_REPLACE(fax_number, '[^0-9]', '') = ? LIMIT 1`,
      [faxNorm]
    );
    if (rows[0]) return { ...rows[0], matchedBy: 'fax_number' };
  }
  const phoneNorm = normPhone(phone_number);
  if (phoneNorm) {
    const [rows] = await conn.query(
      `SELECT id, company_name, fax_number, phone_number FROM customers
        WHERE REGEXP_REPLACE(phone_number, '[^0-9]', '') = ? LIMIT 1`,
      [phoneNorm]
    );
    if (rows[0]) return { ...rows[0], matchedBy: 'phone_number' };
  }
  return null;
}

/**
 * 最終同期日時 (callcenter_last_synced_at) を取得
 */
async function getLastSyncedAt() {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'callcenter_last_synced_at'"
  );
  return rows[0]?.setting_value || null;
}

/**
 * 最終同期日時を NOW() に更新
 */
async function setLastSyncedAt(iso) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, description)
     VALUES ('callcenter_last_synced_at', ?, 'callcenter 顧客マスタの最終同期日時 (ISO8601)。 増分同期のフィルタに使う')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [iso]
  );
}

/**
 * callcenter → fax-crm pull (streaming + batch upsert で 200万件規模対応)
 *   - cc.streamAllCompanies で並列ページ取得
 *   - 各ページごとに 1 multi-row INSERT...ON DUPLICATE KEY UPDATE で upsert
 *   - 既存マッチは external_callcenter_id (UNIQUE) または fax_number (UNIQUE) でMySQLが自動判定
 *
 * @param {object} opts
 *   full           ... true で全件強制 (差分フィルタを無視)、 falseで差分 (デフォルト false)
 *   updatedSince   ... ISO8601 を直接指定する場合 (full=true なら無視)
 */
async function pullFromCallcenter(opts = {}) {
  if (!dbConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; throw err;
  }
  if (!cc.isConfigured()) {
    const err = new Error('callcenter API 連携が未設定 (env: CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN)');
    err.status = 400; err.code = 'NOT_CONFIGURED'; throw err;
  }

  // 差分基準時刻を決定 (full=true なら無視)
  let updatedSince = null;
  if (!opts.full) {
    updatedSince = opts.updatedSince || await getLastSyncedAt();
  }
  // 同期開始時刻を記録 (sync中に更新された行を取りこぼさないよう、 開始時の時刻で次回基準にする)
  const syncStartedIso = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const pool = getPool();
  const stats = {
    mode: updatedSince ? 'incremental' : 'full',
    updated_since: updatedSince,
    fetched: 0, upserted: 0, skipped: 0,
  };
  const startedAt = Date.now();

  // 既存 (sales_list = 0) と 営業 (sales_list = 1) の両系統を順次 stream
  for (const isSalesList of [null, '1']) {
    await cc.streamAllCompanies(
      {
        pageSize: 100, concurrency: 5,
        showExcluded: '1',
        includeSalesList: isSalesList,
        maxPages: 25000,
        updatedSince,
      },
      async (items, meta) => {
        stats.fetched += items.length;
        const rows = items.map((c) => {
          const ccId  = Number(c.id);
          const name  = clip(c.company_name || c.name, 255) || '(未設定)';
          const phone = normPhone(c.phone_number || c.phone);
          if (!ccId || (!phone && !name)) { stats.skipped++; return null; }
          const address = clip(c.address, 65000);
          // 都道府県: 住所から県名を抽出 (callcenter の region は "東北"/"関東" 等の広域なので採用しない)
          //   address から取れなければ region をフォールバックで使う (47都道府県マッチした場合のみ)
          const prefFromAddr = extractPrefecture(address);
          const prefFromRegion = extractPrefecture(c.region);
          const prefecture = prefFromAddr || prefFromRegion || null;
          return {
            company_name: name,
            // callcenter には fax_number 列が存在しないので必ず NULL。
            //   fax_number を勝手に phone で埋めると 「電話番号がFAX欄に入る」 状態になるため。
            fax_number: null,
            phone_number: phone,
            industry: clip(c.industry, 100),
            prefecture: clip(prefecture, 100),
            address,
            external_callcenter_id: ccId,
          };
        }).filter(Boolean);
        if (rows.length === 0) return;

        // multi-row INSERT...ON DUPLICATE KEY UPDATE (肉付けマージ)
        //   重複判定は UNIQUE KEY uk_customers_external_callcenter のみ
        //   (fax_number は NULL なので UNIQUE 衝突しない)
        const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, NOW(), \'callcenter-sync\')').join(', ');
        const values = rows.flatMap((r) => [
          r.company_name, r.fax_number, r.phone_number, r.industry, r.prefecture, r.address, r.external_callcenter_id,
        ]);
        const sql = `
          INSERT INTO customers (
            company_name, fax_number, phone_number, industry, prefecture, address,
            external_callcenter_id, imported_at, source_file
          ) VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE
            external_callcenter_id = COALESCE(customers.external_callcenter_id, VALUES(external_callcenter_id)),
            company_name  = COALESCE(NULLIF(customers.company_name, ''), VALUES(company_name)),
            phone_number  = COALESCE(NULLIF(customers.phone_number, ''), VALUES(phone_number)),
            industry      = COALESCE(NULLIF(customers.industry, ''), VALUES(industry)),
            prefecture    = COALESCE(NULLIF(customers.prefecture, ''), VALUES(prefecture)),
            address       = COALESCE(NULLIF(customers.address, ''), VALUES(address))
            -- fax_number は意図的に更新対象から除外 (callcenter には FAX 情報がないため、
            -- fax-crm 側で別途登録された FAX番号を上書きしないように保護)
        `;
        try {
          const [result] = await pool.query(sql, values);
          stats.upserted += result.affectedRows || 0;
        } catch (e) {
          console.error(`[customerSync] batch failed page=${meta.page} size=${rows.length}: ${e.message}`);
          throw e;
        }
        // 進捗を時々ログ (50ページごと)
        if (meta.page % 50 === 0) {
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          console.log(`[customerSync] page=${meta.page} fetched=${stats.fetched} upserted=${stats.upserted} (${elapsed}s)`);
        }
      }
    );
  }

  // 安全装置: 万一 fax_number に phone_number と同値が入った callcenter-sync 行があれば NULL に戻す
  //   (UPSERT の ON DUPLICATE KEY UPDATE で fax_number は除外しているが、 新規INSERT時の防御)
  try {
    const [r] = await pool.query(`
      UPDATE customers SET fax_number = NULL
       WHERE source_file = 'callcenter-sync'
         AND fax_number IS NOT NULL
         AND fax_number = phone_number
    `);
    if (r.affectedRows > 0) {
      console.log(`[customerSync] auto-cleanup: fax_number==phone_number ${r.affectedRows} 行を NULL に修復`);
      stats.faxCleanedUp = r.affectedRows;
    }
  } catch (e) {
    console.error('[customerSync] auto-cleanup failed:', e.message);
  }

  // 成功時のみ最終同期時刻を更新 (途中失敗時は前回値を維持して次回もう一度フェッチ)
  await setLastSyncedAt(syncStartedIso);
  stats.synced_at = syncStartedIso;
  stats.elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return stats;
}

/**
 * fax-crm → callcenter push (1顧客)
 *   - customer.external_callcenter_id があれば PUT (callcenter 側を更新)
 *   - 無ければ POST → 戻り値 id を保存
 *   - 失敗時は console.error のみ。 fax-crm 側の保存は止めない
 */
async function pushCustomerToCallcenter(customer) {
  if (!cc.isConfigured()) return { skipped: true, reason: 'callcenter API 未設定' };
  if (!customer || !customer.id) return { skipped: true, reason: 'customer.id 無し' };

  // callcenter は phone_number NOT NULL なので、 fax-crm に phone が無い場合は fax_number を仮代入
  const phone = customer.phone_number || customer.fax_number || null;
  if (!phone) return { skipped: true, reason: 'phone/fax 両方無し' };

  const payload = {
    company_name: customer.company_name || '(未設定)',
    phone_number: phone,
    industry: customer.industry || null,
    region: customer.prefecture || null,
    address: customer.address || null,
    comment: customer.fax_number ? `FAX: ${customer.fax_number}` : undefined,
  };

  try {
    let result;
    if (customer.external_callcenter_id) {
      result = await cc.updateCompany(customer.external_callcenter_id, payload);
      return { pushed: 'updated', external_id: customer.external_callcenter_id };
    } else {
      result = await cc.createCompany(payload);
      const newId = result?.id || result?.data?.id;
      if (newId && dbConfigured()) {
        const pool = getPool();
        await pool.query(
          'UPDATE customers SET external_callcenter_id = ? WHERE id = ? AND external_callcenter_id IS NULL',
          [newId, customer.id]
        );
      }
      return { pushed: 'created', external_id: newId };
    }
  } catch (e) {
    console.error(`[customerSync] push failed customer.id=${customer.id}: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * fax-crm → callcenter push (複数)。 cluster of customers を順次 push
 *   fail-soft: 個別失敗は記録して継続
 */
async function pushAllToCallcenter({ limit = 1000 } = {}) {
  if (!cc.isConfigured()) {
    const err = new Error('callcenter API 未設定'); err.status = 400; throw err;
  }
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT id, company_name, fax_number, phone_number, industry, prefecture, address, external_callcenter_id FROM customers LIMIT ?',
    [Math.min(Number(limit) || 1000, 10000)]
  );
  const stats = { total: rows.length, created: 0, updated: 0, errors: 0, skipped: 0 };
  for (const c of rows) {
    const r = await pushCustomerToCallcenter(c);
    if (r.error) stats.errors++;
    else if (r.skipped) stats.skipped++;
    else if (r.pushed === 'created') stats.created++;
    else if (r.pushed === 'updated') stats.updated++;
  }
  return stats;
}

/**
 * 双方向同期 (pull → push を順次実行)
 *   - pull で external_callcenter_id 紐付けを更新してから push することで
 *     既存顧客の重複作成を防ぐ
 *   - 個別のステージが失敗しても他方を試みる (best-effort)
 */
async function syncBothDirections({ pushLimit = 2000, full = false } = {}) {
  const result = { pull: null, push: null, error: null };

  try {
    result.pull = await pullFromCallcenter({ full });
  } catch (e) {
    result.error = `pull失敗: ${e.message}`;
    console.error('[customerSync] pull error:', e.message);
  }

  try {
    result.push = await pushAllToCallcenter({ limit: pushLimit });
  } catch (e) {
    const msg = `push失敗: ${e.message}`;
    result.error = result.error ? `${result.error} | ${msg}` : msg;
    console.error('[customerSync] push error:', e.message);
  }

  return result;
}

module.exports = {
  pullFromCallcenter,
  pushCustomerToCallcenter,
  pushAllToCallcenter,
  syncBothDirections,
  getLastSyncedAt,
  setLastSyncedAt,
  extractPrefecture,
};
