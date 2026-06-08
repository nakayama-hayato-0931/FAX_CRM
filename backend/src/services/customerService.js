const { getPool } = require('../../config/db');
const { normalizeIndustry } = require('../utils/industryCategory');
const { extractPrefecture, isRegionOnly, REGION_ONLY_NAMES, PREFECTURES, withRegionNames } = require('../utils/prefectures');

/**
 * prefecture フィルタを WHERE 句に追加するヘルパ。
 *   query.prefecture が
 *     - 単一文字列     → カンマ区切り として分解 (例: '東京都' / '東京都,神奈川県')
 *     - 配列           → そのまま
 *   選択された県の 該当地域名 も自動で IN リストに加える:
 *     ['茨城県']            → IN ('茨城県','関東')
 *     ['東京都','大阪府']   → IN ('東京都','大阪府','関東','近畿')
 *   これで callcenter.companies の prefecture 列に 「関東」 のような
 *   地域名がそのまま残っているデータも 県名選択でヒットする (旧データ救済)。
 */
function addPrefectureFilter(query, alias, where, params) {
  const v = query.prefecture;
  if (!v) return;
  let list;
  if (Array.isArray(v)) list = v;
  else list = String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return;
  const finalList = withRegionNames(list);
  if (finalList.length === 1) {
    where.push(`${alias}prefecture = ?`);
    params.push(finalList[0]);
  } else {
    where.push(`${alias}prefecture IN (?)`);
    params.push(finalList);
  }
}
const { normalizePhone, digitsOnly } = require('../utils/phone');

const SEARCHABLE = ['company_name', 'fax_number', 'phone_number', 'address'];

const SORT_MAP = {
  updated_at: 'updated_at',
  created_at: 'created_at',
  company_name: 'company_name',
  send_count: 'send_count',
  last_sent_at: 'last_sent_at',
};

async function listCustomers(query = {}) {
  // Phase 3b: USE_CALLCENTER_DB が ON なら repo 経由で callcenter DB から読む
  const repo = require('./customerRepo');
  if (repo.shouldReadFromCallcenter(1)) {
    return repo.listCustomers(query);
  }
  const pool = getPool();
  if (!pool) {
    return { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };
  }

  const where = [];
  const params = [];

  if (query.q) {
    const raw = String(query.q);
    const like = `%${raw}%`;
    // 文字列カラムは通常の LIKE
    // 電話 / FAX カラムは「ハイフン無視」 + 「国際表記 +81 → 0 変換」 で部分一致
    //   ※ digitsOnly() は +81/0081/全角 を吸収して国内形式の桁列に揃える
    const normPhoneDigits = digitsOnly(raw);
    const orParts = SEARCHABLE.map((col) => `c.${col} LIKE ?`);
    SEARCHABLE.forEach(() => params.push(like));
    if (normPhoneDigits.length >= 3) {
      orParts.push(`REGEXP_REPLACE(c.fax_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${normPhoneDigits}%`);
      orParts.push(`REGEXP_REPLACE(c.phone_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${normPhoneDigits}%`);
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  // industry フィルタは「業種カテゴリ (6種)」のいずれかに正規化された値で絞る
  if (query.industry) {
    where.push('c.industry_category = ?');
    params.push(query.industry);
  }
  addPrefectureFilter(query, 'c.', where, params);
  if (query.blacklisted === 'true')  where.push('c.is_blacklisted = 1');
  if (query.blacklisted === 'false') where.push('c.is_blacklisted = 0');
  // has_fax: 数字を含む実 FAX 番号がある顧客に限る (placeholder 等の非数字も除外)
  if (query.has_fax === 'true') {
    where.push(`(c.fax_number IS NOT NULL AND c.fax_number <> '' AND REGEXP_REPLACE(c.fax_number, '[^0-9]', '') <> '')`);
  }
  if (query.has_fax === 'false') {
    where.push(`(c.fax_number IS NULL OR c.fax_number = '' OR REGEXP_REPLACE(c.fax_number, '[^0-9]', '') = '')`);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortCol = SORT_MAP[query.sortBy] || 'updated_at';
  const dir = String(query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(Number(query.pageSize) || 50, 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT c.id, c.company_name, c.fax_number, c.phone_number,
            c.industry, c.industry_category, c.prefecture, c.city,
            c.send_count, c.last_sent_at, c.last_pc_number, c.last_result, c.response_count,
            c.is_blacklisted, c.updated_at, c.external_callcenter_id,
            COALESCE(cc.call_count, 0) AS call_count
       FROM customers c
       LEFT JOIN (
         SELECT customer_id, COUNT(*) AS call_count
           FROM contact_events
          WHERE channel = 'call'
          GROUP BY customer_id
       ) cc ON cc.customer_id = c.id
       ${whereSql}
       ORDER BY c.${sortCol} ${dir}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM customers c ${whereSql}`, params);
  const total = cnt[0].total;

  return {
    items: rows,
    pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * 受電報告 手動入力等で「会社名/電話/FAX のいずれか」 から顧客を確保する
 *   - phone/fax は半角化 + 数字のみに正規化
 *   - 既存 (fax_number / phone_number で照合) があれば再利用
 *   - 無ければ新規 INSERT
 *   - 必要なら industry / prefecture / address / industry_category なども初期化
 *
 *   payload: { company_name, phone_number, fax_number, industry, prefecture, address, source_file }
 */
function _normalizeDigit(s) {
  if (!s) return null;
  // 全角数字を半角に
  // 全角数字 (U+FF10〜U+FF19) を半角に変換
  let t = String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // 全角ハイフン類を半角に
  t = t.replace(/[‐‑‒–—―−ー－]/g, '-');
  // 全角(+) を半角に
  t = t.replace(/[+]/g, '+');
  // 数字 / + / - 以外を除去 + 32文字 clip
  t = t.replace(/[^0-9+\-]/g, '').slice(0, 32);
  return t || null;
}

async function quickCreate(payload = {}) {
  const pool = getPool();
  if (!pool) { const e = new Error('DB未設定'); e.status = 500; throw e; }
  const company = (payload.company_name || '').trim();
  const fax     = _normalizeDigit(payload.fax_number);
  const phone   = _normalizeDigit(payload.phone_number);
  if (!company && !fax && !phone) {
    const e = new Error('company_name / fax_number / phone_number のいずれか必須');
    e.status = 400; e.code = 'NO_KEY'; throw e;
  }

  // 1. 既存検索 (fax → phone → company)、 ハイフン等の差を吸収するため数字のみで比較
  if (fax) {
    const faxDigits = fax.replace(/[^0-9]/g, '');
    if (faxDigits.length >= 6) {
      const [r] = await pool.query(
        `SELECT id, company_name, fax_number, phone_number FROM customers
          WHERE REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') = ? LIMIT 1`,
        [faxDigits]
      );
      if (r[0]) return { ...r[0], reused: 'fax' };
    }
  }
  if (phone) {
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    if (phoneDigits.length >= 6) {
      const [r] = await pool.query(
        `SELECT id, company_name, fax_number, phone_number FROM customers
          WHERE REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') = ? LIMIT 1`,
        [phoneDigits]
      );
      if (r[0]) return { ...r[0], reused: 'phone' };
    }
  }
  if (company && !fax && !phone) {
    // 会社名のみで完全一致 → 既存があれば再利用
    const [r] = await pool.query('SELECT id, company_name, fax_number, phone_number FROM customers WHERE company_name = ? LIMIT 1', [company]);
    if (r[0]) return { ...r[0], reused: 'company_name' };
  }

  // Tier 3: fax-crm に無くても callcenter に同じ顧客がいる可能性をチェック
  const repo = require('./customerRepo');
  if (repo.shouldReadFromCallcenter(3) && (fax || phone)) {
    try {
      const cc = await repo.findExistingInCallcenter({ fax_number: fax, phone_number: phone });
      if (cc) {
        // callcenter にすでに居る場合
        if (cc.external_faxcrm_id) {
          // 既に fax-crm 行と紐付いてる → その fax-crm 行を返す
          const [r] = await pool.query(
            'SELECT id, company_name, fax_number, phone_number FROM customers WHERE id = ? LIMIT 1',
            [cc.external_faxcrm_id]
          );
          if (r[0]) return { ...r[0], reused: 'callcenter:existing' };
        }
        // 紐付け無し → 新規 fax-crm 行を作って external_callcenter_id を紐付け
        const [result] = await pool.query(
          `INSERT INTO customers (company_name, fax_number, phone_number, industry, prefecture, address, external_callcenter_id, source_file, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            company || '(名称未登録)', fax || null, phone || null,
            payload.industry || null, payload.prefecture || null, payload.address || null,
            cc.ccId, payload.source_file || 'tier3-link',
          ]
        );
        // callcenter 側にも external_faxcrm_id 書き戻し
        try {
          const ccDb = require('../../config/callcenterDb');
          const ccPool = ccDb.getPool();
          if (ccPool) {
            await ccPool.query(
              'UPDATE companies SET external_faxcrm_id = ? WHERE id = ? AND external_faxcrm_id IS NULL',
              [result.insertId, cc.ccId]
            );
          }
        } catch (_e) {}
        const [created] = await pool.query('SELECT * FROM customers WHERE id = ?', [result.insertId]);
        try { require('./callcenterDbWriter').shadowUpsert(created[0]); } catch (_e) {}
        return { ...created[0], reused: 'callcenter:linked', created: true };
      }
    } catch (e) {
      // dedup 失敗 → 通常の INSERT に進む (no-op)
      console.warn('[customerService] tier3 callcenter dedup failed:', e.message);
    }
  }

  // 2. 新規 INSERT
  const [result] = await pool.query(
    `INSERT INTO customers (
       company_name, fax_number, phone_number,
       industry, prefecture, address, source_file, imported_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      company || '(名称未登録)',
      fax || null,
      phone || null,
      payload.industry || null,
      payload.prefecture || null,
      payload.address || null,
      payload.source_file || 'manual-entry',
    ]
  );
  const [created] = await pool.query(
    'SELECT * FROM customers WHERE id = ?',
    [result.insertId]
  );
  // Phase 2: callcenter DB にシャドー書き込み (fire-and-forget)
  try { require('./callcenterDbWriter').shadowUpsert(created[0]); } catch (_e) {}
  return { ...created[0], reused: false, created: true };
}

async function getById(id) {
  // Phase 3b Tier 2: USE_CALLCENTER_DB=tier2 以上で callcenter から読む
  const repo = require('./customerRepo');
  if (repo.shouldReadFromCallcenter(2)) {
    return repo.getById(id);
  }
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/**
 * 業種カテゴリ (6種固定) の件数を返す
 *   旧仕様の「industry 詳細を全件 distinct」 から、 6カテゴリ集約に変更
 */
async function getDistinctIndustries() {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT industry_category AS industry, COUNT(*) AS cnt FROM customers
      WHERE industry_category IS NOT NULL AND industry_category <> ''
      GROUP BY industry_category
      ORDER BY FIELD(industry_category, '飲食','製造','小売','宿泊','建設','清掃','農業','介護','運送','その他')`
  );
  return rows;
}

async function getDistinctPrefectures() {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT prefecture, COUNT(*) AS cnt FROM customers
      WHERE prefecture IS NOT NULL AND prefecture <> ''
      GROUP BY prefecture ORDER BY cnt DESC`
  );
  return rows;
}

async function setBlacklist(id, isBlacklisted, reason) {
  const numId = Number(id);
  if (!numId) throw new Error('id 不正');
  const flag = isBlacklisted ? 1 : 0;
  const reasonVal = isBlacklisted ? (reason || 'NG') : null;

  // (A) callcenter-only 顧客 (一覧 id = -callcenter.id の sentinel)
  //     fax-crm に row が無いので callcenter.companies を直接更新する
  if (numId < 0) {
    const ccDb = require('../../config/callcenterDb');
    if (!ccDb.isConfigured()) {
      throw new Error('CALLCENTER_DB が未設定のため callcenter-only 顧客の NG 更新ができません');
    }
    const ccPool = ccDb.getPool();
    await ccPool.query(
      `UPDATE companies SET is_blacklisted = ?, blacklisted_reason = ? WHERE id = ?`,
      [flag, reasonVal, -numId]
    );
    return;
  }

  // (B) fax-crm に row がある通常顧客
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await pool.query(
    `UPDATE customers SET is_blacklisted = ?, blacklisted_reason = ? WHERE id = ?`,
    [flag, reasonVal, numId]
  );
  // Phase 2: callcenter DB にもシャドー反映 (fire-and-forget)
  try {
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [numId]);
    if (rows[0]) require('./callcenterDbWriter').shadowUpsert(rows[0]);
  } catch (_e) {}
}

/**
 * 単一テーブル (customers / companies) の industry_category を
 * industry + note から再算出して UPDATE する内部ヘルパ
 */
async function recategorizeIndustryTable(pool, table, mode, batchSize) {
  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  const byCategory = {};

  while (true) {
    const whereParts = ['id > ?'];
    const params = [lastId];
    if (mode === 'missing') {
      whereParts.push(`(industry_category IS NULL OR industry_category = '' OR industry_category = 'その他')`);
    }
    // industry / note いずれかに手がかりが必要
    whereParts.push(`((industry IS NOT NULL AND industry <> '') OR (note IS NOT NULL AND note <> ''))`);
    const [rows] = await pool.query(
      `SELECT id, industry, industry_category, note
         FROM ${table}
        WHERE ${whereParts.join(' AND ')}
        ORDER BY id ASC
        LIMIT ?`,
      [...params, batchSize]
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    scanned += rows.length;

    const buckets = new Map();
    for (const r of rows) {
      const corpus = [r.industry || '', r.note || ''].filter(Boolean).join(' ');
      const newCat = normalizeIndustry(corpus);
      if ((r.industry_category || '') === newCat) continue;
      if (!buckets.has(newCat)) buckets.set(newCat, []);
      buckets.get(newCat).push(r.id);
    }
    for (const [cat, ids] of buckets) {
      if (!ids.length) continue;
      await pool.query(
        `UPDATE ${table} SET industry_category = ? WHERE id IN (?)`,
        [cat, ids]
      );
      updated += ids.length;
      byCategory[cat] = (byCategory[cat] || 0) + ids.length;
    }
  }

  return { scanned, updated, byCategory };
}

/**
 * 全顧客の industry_category を industry + note から再算出して UPDATE する。
 * fax-crm.customers + callcenter.companies の両 DB を処理する。
 *
 *   options.mode = 'missing'   : industry_category が NULL / '' / 'その他' の行だけ対象
 *                                (デフォルト。 既に明示分類が入っている行は尊重)
 *                = 'all'       : 全顧客 (industry が空でない行) を対象に再分類で上書き
 *   options.batchSize          : 1チャンクあたりの SELECT 件数 (default 2000)
 *
 * 結果: { mode, faxcrm: {...}, callcenter: {...} }
 */
async function recategorizeIndustries(options = {}) {
  const mode = options.mode === 'all' ? 'all' : 'missing';
  const batchSize = Math.max(100, Math.min(Number(options.batchSize) || 2000, 5000));

  const result = { mode };

  // (A) fax-crm.customers
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  result.faxcrm = await recategorizeIndustryTable(pool, 'customers', mode, batchSize);

  // (B) callcenter.companies (接続できる時のみ)
  try {
    const ccDb = require('../../config/callcenterDb');
    if (ccDb.isConfigured()) {
      const ccPool = ccDb.getPool();
      if (ccPool) {
        result.callcenter = await recategorizeIndustryTable(ccPool, 'companies', mode, batchSize);
      } else {
        result.callcenter = { skipped: 'callcenter DB pool 取得不可' };
      }
    } else {
      result.callcenter = { skipped: 'callcenter DB 未設定' };
    }
  } catch (e) {
    console.warn('[recategorizeIndustries] callcenter 処理失敗:', e.message);
    result.callcenter = { skipped: `エラー: ${e.message}` };
  }

  return result;
}

/**
 * 単一テーブル (customers / companies) の prefecture を address から
 * 再抽出して UPDATE する内部ヘルパ
 */
async function normalizePrefectureTable(pool, table, mode, batchSize) {
  const regionList = Array.from(REGION_ONLY_NAMES);
  const validPrefSet = new Set(PREFECTURES);
  // mode='invalid' の対象: 「NULLでも空でもなく、 47都道府県でもない」 値 (例: 岐阜市水海道、 大阪市都 等)
  const whereByMode = () => {
    if (mode === 'region')  return `prefecture IN (?)`;
    if (mode === 'missing') return `(prefecture IS NULL OR prefecture = '')`;
    if (mode === 'invalid') return `(prefecture IS NOT NULL AND prefecture <> '' AND prefecture NOT IN (?))`;
    return `1=1`;
  };
  const paramsByMode = () => {
    if (mode === 'region')  return [regionList];
    if (mode === 'invalid') return [PREFECTURES];
    return [];
  };
  // address 必須: invalid モードは address から抽出できなかった行は NULL に戻す
  const requireAddress = mode !== 'invalid';

  let lastId = 0;
  let scanned = 0;
  let updated = 0;
  let cleared = 0;  // NULL に戻した件数
  const byPref = {};

  while (true) {
    const [rows] = await pool.query(
      `SELECT id, prefecture, address
         FROM ${table}
        WHERE id > ?
          AND ${whereByMode()}
          ${requireAddress ? "AND address IS NOT NULL AND address <> ''" : ''}
        ORDER BY id ASC
        LIMIT ?`,
      [lastId, ...paramsByMode(), batchSize]
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;
    scanned += rows.length;

    const buckets = new Map();
    const clearIds = [];
    for (const r of rows) {
      const extracted = extractPrefecture(r.address);
      if (extracted) {
        if (extracted === r.prefecture) continue;
        if (!buckets.has(extracted)) buckets.set(extracted, []);
        buckets.get(extracted).push(r.id);
      } else if (mode === 'invalid') {
        // address からも抽出できず、 現値も 47県以外 → NULL に戻す
        if (r.prefecture && !validPrefSet.has(r.prefecture)) clearIds.push(r.id);
      }
    }
    // 47県以外を NULL に戻す bulk UPDATE
    if (clearIds.length) {
      await pool.query(
        `UPDATE ${table} SET prefecture = NULL WHERE id IN (?)`,
        [clearIds]
      );
      cleared += clearIds.length;
    }
    for (const [pref, ids] of buckets) {
      if (!ids.length) continue;
      await pool.query(
        `UPDATE ${table} SET prefecture = ? WHERE id IN (?)`,
        [pref, ids]
      );
      updated += ids.length;
      byPref[pref] = (byPref[pref] || 0) + ids.length;
    }
  }

  return { scanned, updated, cleared, byPrefecture: byPref };
}

/**
 * customers.prefecture (fax-crm) と companies.prefecture (callcenter)
 * の 「東北/関東/中部/近畿/中国/四国/九州」 等の地域名や、
 * 「岐阜市水海道」 「大阪市都」 等のバグ抽出値を address から再抽出して 県名 に正規化する。
 *
 * USE_CALLCENTER_DB=tier1+ モードでは 一覧/詳細は callcenter.companies から
 * 読むので fax-crm 側だけ正規化しても 「近畿」 のまま表示される問題があるため
 * callcenter DB が接続できる時は 両方を処理する。
 *
 * options.mode = 'region' (default) : 地域名 (東北/関東/...) だけを対象
 *                'missing'          : NULL / 空文字 だけを対象
 *                'invalid'          : 47都道府県以外の値が入っている行を全て対象
 *                                     (address 抽出失敗時は NULL に戻す)
 *                'all'              : 全行 (address があれば常に再抽出)
 *
 * 結果: { mode, faxcrm: {scanned, updated, cleared, byPrefecture},
 *         callcenter: {scanned, updated, cleared, byPrefecture, skipped?} }
 */
async function normalizePrefectures(options = {}) {
  const mode = ['region', 'missing', 'invalid', 'all'].includes(options.mode) ? options.mode : 'region';
  const batchSize = Math.max(100, Math.min(Number(options.batchSize) || 2000, 5000));

  const result = { mode };

  // (A) fax-crm.customers
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  result.faxcrm = await normalizePrefectureTable(pool, 'customers', mode, batchSize);

  // (B) callcenter.companies (接続できる時のみ)
  try {
    const ccDb = require('../../config/callcenterDb');
    if (ccDb.isConfigured()) {
      const ccPool = ccDb.getPool();
      if (ccPool) {
        result.callcenter = await normalizePrefectureTable(ccPool, 'companies', mode, batchSize);
      } else {
        result.callcenter = { skipped: 'callcenter DB pool 取得不可' };
      }
    } else {
      result.callcenter = { skipped: 'callcenter DB 未設定' };
    }
  } catch (e) {
    console.warn('[normalizePrefectures] callcenter 処理失敗:', e.message);
    result.callcenter = { skipped: `エラー: ${e.message}` };
  }

  return result;
}

/**
 * 電話番号 / FAX 番号 で 顧客を検索。
 *   - 入力を normalizePhone で 国内桁列 にしてから REGEXP_REPLACE で
 *     customers.phone_number / fax_number と digits-only マッチ
 *   - 後方一致 (10 桁市外局番下位8桁) 等も含む拡張ヒットを返す
 *
 *   limit を 1 にすれば 1 件だけ取得 (auto-suggest 用)
 *   limit > 1 で candidate 一覧 (複数一致時のユーザ選択用)
 */
async function findByPhoneNormalized(rawPhone, { limit = 10 } = {}) {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return [];
  const pool = getPool();
  if (!pool) return [];

  // 完全一致 (digits-only) + 後方一致 (下 9 桁) の OR
  //   下 9 桁マッチは callcenter 由来の番号が一部桁落ちしているケースの保険
  const tail9 = normalized.slice(-9);
  const [rows] = await pool.query(
    `SELECT id, company_name, fax_number, phone_number,
            industry, industry_category, prefecture, city, address,
            is_blacklisted, last_result, send_count, response_count
       FROM customers
      WHERE REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') = ?
         OR REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') = ?
         OR REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') LIKE ?
         OR REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') LIKE ?
      LIMIT ?`,
    [normalized, normalized, `%${tail9}`, `%${tail9}`, Number(limit)]
  );
  return rows;
}

module.exports = {
  listCustomers,
  getById,
  quickCreate,
  getDistinctIndustries,
  getDistinctPrefectures,
  setBlacklist,
  recategorizeIndustries,
  normalizePrefectures,
  findByPhoneNormalized,
};
