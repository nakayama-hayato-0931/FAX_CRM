const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const { getPool, isConfigured } = require('../../config/db');
const { normalizeIndustry } = require('../utils/industryCategory');

/**
 * インポートの 3 モード:
 *   - 'new'      新規リスト    : 会社名/電話/FAX のいずれかで既存 (NG含む) と一致したらスキップ。
 *                  未一致のみ insert (is_blacklisted=0)
 *   - 'existing' 既存リスト    : 既に取引のある企業を 新規営業対象外 にする。NG とほぼ同じ
 *                  扱いで is_blacklisted=1。blacklisted_reason のデフォルトは「既存取引先」
 *   - 'ng'       NGリスト      : 配信停止依頼などの NG 登録。一致した顧客を is_blacklisted=1
 *                  + 理由更新。未一致は NG 付きで 新規 insert。
 *                  blacklisted_reason のデフォルトは「NG」
 *
 * 入力形式は 自動判別:
 *   - .csv / .txt  → csv-parser (UTF-8)
 *   - .xls (BIFF8) → SheetJS で BIFF 解析
 *   - .xlsx        → SheetJS で OOXML 解析
 *
 * Urizo (売り蔵) データリスト形式の列も そのまま取り込めるよう
 * HEADER_ALIASES でマッピング。 自社で持っていない補助列
 * (メール / データ元 / 設立日 / 売上高 / 資本金 / 担当者名 / 法人番号 等) は
 * note フィールドに `ラベル: 値` 形式で集約して情報を残す。
 */
const MODES = new Set(['new', 'existing', 'ng']);

const DEFAULT_REASON = {
  existing: '既存取引先',
  ng: 'NG',
};

// 47都道府県 (住所からの抽出用)
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

function extractPrefecture(address) {
  if (!address) return null;
  const s = String(address).trim();
  if (!s) return null;
  for (const pref of PREFECTURES) {
    if (s.startsWith(pref) || s.includes(pref)) return pref;
  }
  const m = s.match(/^([^\s\d]+?[都道府県])/);
  if (m && m[1].length <= 6) return m[1];
  return null;
}

/**
 * 入力ヘッダ → 内部キー の対応表。
 *   '_meta_xxx' プレフィックス付きの内部キーは「DB列にはマップせず note に集約」 する印。
 */
const HEADER_ALIASES = {
  // 基本列
  '会社名': 'company_name', '企業名': 'company_name', 'company_name': 'company_name',
  'FAX': 'fax_number', 'FAX番号': 'fax_number', 'fax': 'fax_number', 'fax_number': 'fax_number',
  '電話番号': 'phone_number', 'TEL': 'phone_number', 'phone': 'phone_number', 'phone_number': 'phone_number',
  '業種': 'industry', 'industry': 'industry',
  '業種詳細': 'industry_detail',
  '都道府県': 'prefecture', 'prefecture': 'prefecture',
  '市区町村': 'city', 'city': 'city',
  '住所': 'address', 'address': 'address',
  '郵便番号': 'postal_code', 'postal_code': 'postal_code',
  'URL': 'url', 'HP': 'url', 'url': 'url',
  '従業員数': 'employee_count', 'employee_count': 'employee_count',
  '代表者': 'representative', '代表者名': 'representative', 'representative': 'representative',
  '備考': 'note', 'メモ': 'note', 'コメント': 'note', 'note': 'note',
  'NG理由': 'blacklisted_reason', 'ブラック理由': 'blacklisted_reason',
  'blacklisted_reason': 'blacklisted_reason',
  // Urizo 形式の追加列 (note に集約)
  'メール':                 '_meta_email',
  'email':                  '_meta_email',
  'E-mail':                 '_meta_email',
  'データ元':               '_meta_source',
  '設立日':                 '_meta_founded',
  '売上高':                 '_meta_revenue',
  '資本金':                 '_meta_capital',
  '担当者名':               '_meta_contact',
  'お問い合わせフォーム':   '_meta_inquiry_url',
  '職種':                   '_meta_jobtype',
  '法人番号':               '_meta_corporate_no',
  '日付':                   '_meta_date',
  '最終更新日':             '_meta_updated',
};

const VALID = new Set([
  'company_name', 'fax_number', 'phone_number', 'industry', 'industry_category',
  'prefecture', 'city', 'address', 'postal_code', 'url',
  'employee_count', 'representative', 'note', 'blacklisted_reason',
]);

/**
 * FAX / 電話 を正規化。 数字 + プラスのみ残す。
 * 「未入力プレースホルダ」は null 化 (これを残すと UNIQUE 制約に衝突):
 *   - 全部 0 (例: 0000000000)
 *   - 全部同じ数字 (例: 1111111111)
 *   - 9 桁未満 (日本国内の電話/FAXは最短でも 9 桁)
 */
function normalizeFax(v) {
  if (!v) return null;
  const s = String(v).replace(/[^0-9+]/g, '').trim();
  if (!s) return null;
  const digits = s.replace(/\+/g, '');
  if (/^0+$/.test(digits)) return null;
  if (/^(\d)\1+$/.test(digits)) return null;
  if (digits.length < 9) return null;
  return s;
}

/** マッチング用に数字のみ抽出 (ハイフン無視) */
function digitsOnly(v) {
  if (!v) return '';
  return String(v).replace(/[^0-9]/g, '');
}

function normalizePostal(v) {
  if (!v) return null;
  // 〒 / 全角スペース / 半角スペース / ハイフン以外の記号 を除去
  return String(v).replace(/[〒\s　]/g, '').trim() || null;
}

/**
 * Urizo の 従業員数 列はタブ装飾 + "人" 付き ("企業全体\t\t\t\t\t\t\t68人")
 * 数字のみ抽出して int に
 */
function normalizeEmployeeCount(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[,，]/g, '');
  const m = s.match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function rowToCustomer(rawRow) {
  // 1. ヘッダを 内部キー に正規化 (未知の列は無視)
  const norm = {};
  const meta = [];  // Urizo の補助列を保存
  for (const [rawK, rawV] of Object.entries(rawRow)) {
    if (rawK == null) continue;
    const key = String(rawK).trim();
    const internal = HEADER_ALIASES[key];
    if (!internal) continue;
    if (rawV === undefined || rawV === null) continue;
    const v = String(rawV).trim();
    if (!v) continue;
    if (internal.startsWith('_meta_')) {
      meta.push(`${key}: ${v}`);
      continue;
    }
    norm[internal] = v;
  }

  // 2. DB 列 に整形
  const out = {};
  if (norm.company_name) out.company_name = norm.company_name;
  if (norm.fax_number)   out.fax_number   = normalizeFax(norm.fax_number);
  if (norm.phone_number) out.phone_number = normalizeFax(norm.phone_number);
  // 業種詳細 > 業種 の優先 (Urizoの業種詳細はカテゴリ抽出した文字列の傾向)
  if (norm.industry_detail || norm.industry) {
    out.industry = norm.industry_detail || norm.industry;
  }
  if (norm.prefecture) out.prefecture = norm.prefecture;
  if (!out.prefecture && norm.address) {
    const pref = extractPrefecture(norm.address);
    if (pref) out.prefecture = pref;
  }
  if (norm.city) out.city = norm.city;
  if (norm.address) out.address = norm.address;
  if (norm.postal_code) out.postal_code = normalizePostal(norm.postal_code);
  if (norm.url) out.url = norm.url;
  if (norm.employee_count !== undefined) {
    const n = normalizeEmployeeCount(norm.employee_count);
    if (n !== null) out.employee_count = n;
  }
  if (norm.representative) out.representative = norm.representative;
  if (norm.blacklisted_reason) out.blacklisted_reason = norm.blacklisted_reason;

  // 3. note = (本文 メモ/備考) + (Urizo の補助列) を改行結合
  const noteParts = [];
  if (norm.note) noteParts.push(norm.note);
  if (meta.length) noteParts.push(...meta);
  if (noteParts.length) out.note = noteParts.join('\n');

  // 4. 業種カテゴリ を自動判定 (2 段階)
  //    (a) まず 業種 / 業種詳細 だけで判定 (Urizo の 「業種」 は構造化された
  //        カテゴリ名 「コンビニエンスストア, 各種商品小売業」 等で 信頼性が高い)
  //    (b) 上記で 「その他」 になった時のみ コメント本文 に fallback
  //
  //    note に集約される 職種 (募集職種) は意図的に外す:
  //      例) 食品工場が 介護スタッフ を募集 → 業種は 製造 のままにしたい
  const primaryCorpus = [norm.industry, norm.industry_detail].filter(Boolean).join(' ');
  let cat = normalizeIndustry(primaryCorpus);
  if (cat === 'その他' && norm.note) {
    cat = normalizeIndustry(`${primaryCorpus} ${norm.note}`);
  }
  out.industry_category = cat;

  return out;
}

/**
 * ファイルパスから rows[] を取得 (CSV / XLS / XLSX 自動判別)
 *   元ファイル名から拡張子を推定 (multer の tmp 名には拡張子が無いため)
 */
async function parseFile(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === '.xls' || ext === '.xlsx' || ext === '.xlsm' || ext === '.xlsb') {
    return parseExcel(filePath);
  }
  // それ以外 (.csv / .txt / 拡張子無し) は CSV として試行
  return parseCsv(filePath);
}

function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function parseExcel(filePath) {
  // BIFF8 .xls / OOXML .xlsx 両対応。 codepage=932 は Shift-JIS の保険
  const wb = XLSX.readFile(filePath, { cellDates: true, codepage: 932 });
  if (!wb.SheetNames.length) return [];
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // raw:false → 数値/日付 もフォーマット済み文字列で取得 (列ごとに型がバラつく対策)
  // defval:'' → 空セルも '' で揃えてキー集合を一定にする
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

/**
 * mode 別の取込処理
 *   1チャンク = 500件 で:
 *     - 入力値から company_name / digits(phone) / digits(fax) を集める
 *     - 既存顧客を 3 軸 OR で bulk SELECT
 *     - 各行を分類 (insert / update / skip / blacklist)
 *   ハイフン無視マッチに REGEXP_REPLACE を使用
 */
async function processImport(rows, sourceFile, mode) {
  const stats = { inserted: 0, updated: 0, skipped: 0, blacklisted: 0 };
  if (!rows.length) return stats;

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      // 1. lookup 値を集約
      const names = new Set(), phones = new Set(), faxes = new Set();
      for (const r of chunk) {
        if (r.company_name) names.add(r.company_name);
        if (r.phone_number) { const d = digitsOnly(r.phone_number); if (d) phones.add(d); }
        if (r.fax_number)   { const d = digitsOnly(r.fax_number);   if (d) faxes.add(d); }
      }

      // 2. bulk SELECT で既存マッチを取得
      const conditions = [];
      const params = [];
      if (names.size) {
        conditions.push(`company_name IN (?)`);
        params.push(Array.from(names));
      }
      if (phones.size) {
        conditions.push(`REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') IN (?)`);
        params.push(Array.from(phones));
      }
      if (faxes.size) {
        conditions.push(`REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') IN (?)`);
        params.push(Array.from(faxes));
      }
      let existing = [];
      if (conditions.length) {
        const [rows2] = await conn.query(
          `SELECT id, company_name, phone_number, fax_number, is_blacklisted
             FROM customers WHERE ${conditions.join(' OR ')}`,
          params
        );
        existing = rows2;
      }

      // 3. lookup 構築 (mode 別)
      // new モードは NG/既存 と 非NG を分離して保持する
      const blkNames = new Set(), blkPhones = new Set(), blkFaxes = new Set();
      const actPhoneMap = new Map(), actFaxMap = new Map();
      // existing/ng モード用 (1 軸でも一致した最初の顧客を返す)
      const byName = new Map(), byPhone = new Map(), byFax = new Map();

      for (const e of existing) {
        if (mode === 'new') {
          if (e.is_blacklisted) {
            if (e.company_name) blkNames.add(e.company_name);
            if (e.phone_number) { const d = digitsOnly(e.phone_number); if (d) blkPhones.add(d); }
            if (e.fax_number)   { const d = digitsOnly(e.fax_number);   if (d) blkFaxes.add(d); }
          } else {
            // 非NG の 電話/FAX → 肉付け対象として保存 (会社名は match 軸でないので不要)
            if (e.phone_number) { const d = digitsOnly(e.phone_number); if (d && !actPhoneMap.has(d)) actPhoneMap.set(d, e.id); }
            if (e.fax_number)   { const d = digitsOnly(e.fax_number);   if (d && !actFaxMap.has(d))   actFaxMap.set(d, e.id); }
          }
        } else {
          if (e.company_name && !byName.has(e.company_name)) byName.set(e.company_name, e);
          if (e.phone_number) { const d = digitsOnly(e.phone_number); if (d && !byPhone.has(d)) byPhone.set(d, e); }
          if (e.fax_number)   { const d = digitsOnly(e.fax_number);   if (d && !byFax.has(d))   byFax.set(d, e); }
        }
      }

      // 4. 行ごと分類処理
      for (const r of chunk) {
        const phoneD = r.phone_number ? digitsOnly(r.phone_number) : '';
        const faxD   = r.fax_number   ? digitsOnly(r.fax_number)   : '';

        if (mode === 'new') {
          if (!r.company_name) { stats.skipped++; continue; }
          // (1) NG/既存リストと一致 (どの軸でも) → skip
          const isBlacklisted =
            blkNames.has(r.company_name) ||
            (phoneD && blkPhones.has(phoneD)) ||
            (faxD && blkFaxes.has(faxD));
          if (isBlacklisted) { stats.skipped++; continue; }
          // (2) 非NG の 電話/FAX と一致 → 肉付けマージ (会社名 一致 だけでは merge しない)
          const mergeId =
            (phoneD && actPhoneMap.get(phoneD)) ||
            (faxD && actFaxMap.get(faxD));
          if (mergeId) {
            await updateExisting(conn, mergeId, r);
            stats.updated++;
            // 後続行が同じ顧客を参照できるよう lookup を更新 (電話/FAX が新たに埋まったケースに備えて)
            if (phoneD) actPhoneMap.set(phoneD, mergeId);
            if (faxD)   actFaxMap.set(faxD, mergeId);
            continue;
          }
          // (3) 非NG 会社名のみ一致 または 完全未一致 → 新規 insert (同名別企業として扱う)
          const newId = await insertSingle(conn, r, { sourceFile, blacklist: false });
          stats.inserted++;
          if (phoneD) actPhoneMap.set(phoneD, newId);
          if (faxD)   actFaxMap.set(faxD, newId);
        } else if (mode === 'existing' || mode === 'ng') {
          const match =
            (r.company_name && byName.get(r.company_name)) ||
            (phoneD && byPhone.get(phoneD)) ||
            (faxD && byFax.get(faxD)) ||
            null;
          // 既存/NG: 一致したら is_blacklisted=1 にして新規営業対象外 にする。
          // 未一致は ブラックリスト付き で新規 insert (会社名 必須)。
          const reasonDefault = DEFAULT_REASON[mode] || null;
          const reason = r.blacklisted_reason || r.note || reasonDefault;
          if (match) {
            await conn.query(
              `UPDATE customers
                  SET is_blacklisted = 1,
                      blacklisted_reason = COALESCE(blacklisted_reason, ?)
                WHERE id = ?`,
              [reason, match.id]
            );
            if (match.is_blacklisted) stats.updated++;
            else stats.blacklisted++;
          } else {
            if (!r.company_name) { stats.skipped++; continue; }
            const newId = await insertSingle(conn, r, { sourceFile, blacklist: true, reason });
            stats.inserted++;
            stats.blacklisted++;
            if (r.company_name) byName.set(r.company_name, { id: newId, is_blacklisted: 1 });
            if (phoneD)         byPhone.set(phoneD,        { id: newId, is_blacklisted: 1 });
            if (faxD)           byFax.set(faxD,            { id: newId, is_blacklisted: 1 });
          }
        }
      }
    }
  } finally {
    conn.release();
  }
  return stats;
}

/**
 * 肉付けマージ: 既存に値があれば残し、空欄(NULL)だけ新値で埋める。
 *   new モードで「非NG顧客の電話/FAXと一致」したときに使う。
 *   会社名は NOT NULL なので新値で上書きしない (既存値を維持)。
 *   note は既存があれば末尾に追記する (情報を失わないため)。
 */
async function updateExisting(conn, id, r) {
  // industry_category は 「未分類 / その他 だった行は新値で上書き」 (運用上の改善)、
  // 既に明示カテゴリ (飲食/製造/...) が入っているものは尊重する
  await conn.query(
    `UPDATE customers SET
       fax_number        = COALESCE(fax_number,     ?),
       phone_number      = COALESCE(phone_number,   ?),
       industry          = COALESCE(industry,       ?),
       industry_category = CASE
                             WHEN industry_category IS NULL OR industry_category = '' OR industry_category = 'その他'
                               THEN COALESCE(?, industry_category)
                             ELSE industry_category
                           END,
       prefecture        = COALESCE(prefecture,     ?),
       city              = COALESCE(city,           ?),
       address           = COALESCE(address,        ?),
       postal_code       = COALESCE(postal_code,    ?),
       url               = COALESCE(url,            ?),
       employee_count    = COALESCE(employee_count, ?),
       representative    = COALESCE(representative, ?),
       note              = CASE
                             WHEN ? IS NULL THEN note
                             WHEN note IS NULL OR note = '' THEN ?
                             ELSE CONCAT(note, '\n----\n', ?)
                           END
     WHERE id = ?`,
    [
      r.fax_number || null, r.phone_number || null, r.industry || null,
      r.industry_category || null,
      r.prefecture || null, r.city || null, r.address || null,
      r.postal_code || null, r.url || null, r.employee_count ?? null,
      r.representative || null,
      r.note || null, r.note || null, r.note || null,
      id,
    ]
  );
}

async function insertSingle(conn, r, { sourceFile, blacklist, reason }) {
  const blacklistReason = blacklist
    ? (reason || r.blacklisted_reason || r.note || null)
    : (r.blacklisted_reason || null);
  const [result] = await conn.query(
    `INSERT INTO customers
       (company_name, fax_number, phone_number, industry, industry_category,
        prefecture, city, address,
        postal_code, url, employee_count, representative, note,
        is_blacklisted, blacklisted_reason, source_file, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      r.company_name, r.fax_number || null, r.phone_number || null,
      r.industry || null, r.industry_category || null,
      r.prefecture || null, r.city || null, r.address || null,
      r.postal_code || null, r.url || null, r.employee_count ?? null,
      r.representative || null, r.note || null,
      blacklist ? 1 : 0,
      blacklistReason,
      sourceFile || null,
    ]
  );
  return result.insertId;
}

async function importCsv(filePath, originalName, options = {}) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です。.env の DB_HOST 等を設定してください');
    err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const mode = options.mode || 'new';
  if (!MODES.has(mode)) {
    const err = new Error(`不正な mode: ${mode} (許容: new / existing / ng)`);
    err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }

  const rawRows = await parseFile(filePath, originalName);
  const totalRows = rawRows.length;
  const customers = rawRows
    .map(rowToCustomer)
    // 全モード共通: 会社名 必須 (未マッチ時の 新規 insert で company_name が必須カラムのため)
    .filter((c) => c.company_name);

  const stats = await processImport(customers, originalName, mode);
  return { totalRows, validRows: customers.length, mode, ...stats };
}

module.exports = { importCsv, rowToCustomer, parseFile, HEADER_ALIASES, MODES };
