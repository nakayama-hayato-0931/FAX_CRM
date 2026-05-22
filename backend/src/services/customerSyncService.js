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
 * callcenter → fax-crm pull (全件)
 */
async function pullFromCallcenter() {
  if (!dbConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; throw err;
  }
  if (!cc.isConfigured()) {
    const err = new Error('callcenter API 連携が未設定 (env: CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN)');
    err.status = 400; err.code = 'NOT_CONFIGURED'; throw err;
  }

  // 営業リスト + オペレータリスト 両方 + 除外フラグ付きも取得
  const companies = await cc.listAllCompaniesBothLists({ pageSize: 100, showExcluded: '1' });
  const pool = getPool();
  const conn = await pool.getConnection();
  const stats = { fetched: companies.length, linked: 0, updated: 0, inserted: 0, skippedNoPhone: 0 };

  try {
    for (const c of companies) {
      // callcenter の主要フィールド (snake_case で来る想定) + DB上限に合わせて clip
      const ccId       = Number(c.id);
      const name       = clip(c.company_name || c.name, 255);
      const phone      = normPhone(c.phone_number || c.phone);
      const industry   = clip(c.industry, 100);
      const region     = clip(c.region, 100);    // customers.prefecture VARCHAR(100)
      const address    = clip(c.address, 65000); // TEXT

      if (!phone && !name) { stats.skippedNoPhone++; continue; }

      const existing = await findExistingCustomer(conn, {
        external_id: ccId,
        phone_number: phone,
        // callcenter には fax_number は無いので skip
      });

      if (existing) {
        // 肉付けマージ: 既存値を保持、 空欄のみ callcenter 由来で埋める。 external_callcenter_id は必ずセット
        await conn.query(
          `UPDATE customers SET
             external_callcenter_id = COALESCE(external_callcenter_id, ?),
             company_name  = COALESCE(NULLIF(company_name, ''), ?),
             phone_number  = COALESCE(NULLIF(phone_number, ''), ?),
             industry      = COALESCE(NULLIF(industry, ''), ?),
             prefecture    = COALESCE(NULLIF(prefecture, ''), ?),
             address       = COALESCE(NULLIF(address, ''), ?)
           WHERE id = ?`,
          [ccId, name, phone, industry, region, address, existing.id]
        );
        if (existing.matchedBy === 'external_id') stats.updated++;
        else stats.linked++;  // 既存行に external_id を初めて紐付け
      } else {
        // 新規: phone を fax_number にも仮置き (重複防止のため fax_number は phone と同値で挿入)
        //   ※ UNIQUE KEY uk_customers_fax があるため空文字や NULL 連続でも入る形にする
        const faxNumberForUniq = phone || `__cc_${ccId}__`;  // 一意性確保用のダミー
        try {
          await conn.query(
            `INSERT INTO customers (
               company_name, fax_number, phone_number, industry, prefecture, address,
               external_callcenter_id, imported_at, source_file
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'callcenter-sync')`,
            [name || '(未設定)', faxNumberForUniq, phone, industry, region, address, ccId]
          );
          stats.inserted++;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') {
            // 競合: 同 fax_number で既に登録あり → 紐付けのみ実施
            await conn.query(
              `UPDATE customers
                  SET external_callcenter_id = COALESCE(external_callcenter_id, ?)
                WHERE fax_number = ? AND external_callcenter_id IS NULL`,
              [ccId, faxNumberForUniq]
            );
            stats.linked++;
          } else { throw e; }
        }
      }
    }
  } finally { conn.release(); }
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
async function syncBothDirections({ pushLimit = 2000 } = {}) {
  const result = { pull: null, push: null, error: null };

  try {
    result.pull = await pullFromCallcenter();
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
};
