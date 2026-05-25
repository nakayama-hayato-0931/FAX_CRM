const fs = require('fs');
const csv = require('csv-parser');
const { getPool, isConfigured } = require('../../config/db');

/**
 * CSV インポートの 3 モード:
 *   - 'new'      新規リスト    : 会社名/電話/FAX のいずれかで既存 (NG含む) と一致したらスキップ。
 *                  未一致のみ insert (is_blacklisted=0)
 *   - 'existing' 既存リスト    : 既に取引のある企業を 新規営業対象外 にする。NG とほぼ同じ
 *                  扱いで is_blacklisted=1。blacklisted_reason のデフォルトは「既存取引先」
 *   - 'ng'       NGリスト      : 配信停止依頼などの NG 登録。一致した顧客を is_blacklisted=1
 *                  + 理由更新。未一致は NG 付きで 新規 insert。
 *                  blacklisted_reason のデフォルトは「NG」
 */
const MODES = new Set(['new', 'existing', 'ng']);

const DEFAULT_REASON = {
  existing: '既存取引先',
  ng: 'NG',
};

const DEFAULT_MAPPING = {
  '会社名': 'company_name', '企業名': 'company_name', 'company_name': 'company_name',
  'FAX': 'fax_number', 'FAX番号': 'fax_number', 'fax': 'fax_number', 'fax_number': 'fax_number',
  '電話番号': 'phone_number', 'TEL': 'phone_number', 'phone': 'phone_number', 'phone_number': 'phone_number',
  '業種': 'industry', 'industry': 'industry',
  '都道府県': 'prefecture', 'prefecture': 'prefecture',
  '市区町村': 'city', 'city': 'city',
  '住所': 'address', 'address': 'address',
  '郵便番号': 'postal_code', 'postal_code': 'postal_code',
  'URL': 'url', 'HP': 'url', 'url': 'url',
  '従業員数': 'employee_count', 'employee_count': 'employee_count',
  '代表者': 'representative', 'representative': 'representative',
  '備考': 'note', 'メモ': 'note', 'note': 'note',
  'NG理由': 'blacklisted_reason', 'ブラック理由': 'blacklisted_reason',
  'blacklisted_reason': 'blacklisted_reason',
};

const VALID = new Set([
  'company_name', 'fax_number', 'phone_number', 'industry',
  'prefecture', 'city', 'address', 'postal_code', 'url',
  'employee_count', 'representative', 'note', 'blacklisted_reason',
]);

function normalizeFax(v) {
  if (!v) return null;
  return String(v).replace(/[^0-9+]/g, '').trim() || null;
}

/** マッチング用に数字のみ抽出 (ハイフン無視) */
function digitsOnly(v) {
  if (!v) return '';
  return String(v).replace(/[^0-9]/g, '');
}

function rowToCustomer(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const dbKey = DEFAULT_MAPPING[k] || DEFAULT_MAPPING[k?.trim()];
    if (!dbKey || !VALID.has(dbKey)) continue;
    if (v === undefined || v === null || v === '') continue;
    if (dbKey === 'fax_number') {
      out[dbKey] = normalizeFax(v);
    } else if (dbKey === 'phone_number') {
      out[dbKey] = normalizeFax(v);  // 同じ正規化 (半角数字+ハイフン除去)
    } else if (dbKey === 'employee_count') {
      const n = Number(String(v).replace(/[^0-9.-]/g, ''));
      out[dbKey] = Number.isFinite(n) ? n : null;
    } else {
      out[dbKey] = String(v).trim();
    }
  }
  return out;
}

/**
 * mode 別の取込処理
 *   1チャンク = 500件 で:
 *     - CSV 値から company_name / digits(phone) / digits(fax) を集める
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
 */
async function updateExisting(conn, id, r) {
  await conn.query(
    `UPDATE customers SET
       fax_number     = COALESCE(fax_number,     ?),
       phone_number   = COALESCE(phone_number,   ?),
       industry       = COALESCE(industry,       ?),
       prefecture     = COALESCE(prefecture,     ?),
       city           = COALESCE(city,           ?),
       address        = COALESCE(address,        ?),
       postal_code    = COALESCE(postal_code,    ?),
       url            = COALESCE(url,            ?),
       employee_count = COALESCE(employee_count, ?),
       representative = COALESCE(representative, ?),
       note           = COALESCE(note,           ?)
     WHERE id = ?`,
    [
      r.fax_number || null, r.phone_number || null, r.industry || null,
      r.prefecture || null, r.city || null, r.address || null,
      r.postal_code || null, r.url || null, r.employee_count ?? null,
      r.representative || null, r.note || null,
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
       (company_name, fax_number, phone_number, industry, prefecture, city, address,
        postal_code, url, employee_count, representative, note,
        is_blacklisted, blacklisted_reason, source_file, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      r.company_name, r.fax_number || null, r.phone_number || null,
      r.industry || null, r.prefecture || null, r.city || null, r.address || null,
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

  const customers = [];
  let totalRows = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        totalRows++;
        const c = rowToCustomer(row);
        // 全モード共通: 会社名 必須 (未マッチ時の 新規 insert で company_name が必須カラムのため)
        if (c.company_name) customers.push(c);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const stats = await processImport(customers, originalName, mode);
  return { totalRows, validRows: customers.length, mode, ...stats };
}

module.exports = { importCsv, rowToCustomer, DEFAULT_MAPPING, MODES };
