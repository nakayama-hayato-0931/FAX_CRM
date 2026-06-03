/**
 * リスト抽出 NGワード管理 + WHERE 条件ビルダ
 *
 * 設計:
 *   - ng_words テーブルに { field, word, enabled } を保存
 *   - field は customers の検索可能列に限定 (company_name / industry / address /
 *     note / url / representative)
 *   - extraction の buildWhere から buildNgWordWhereClause() を呼ぶと
 *     「該当列に enabled なワードを含む顧客を除外」 する SQL 断片を返す
 */
const { getPool } = require('../../config/db');

const VALID_FIELDS = new Set([
  'company_name',
  'industry',
  'address',
  'note',
  'url',
  'representative',
]);

// Railway デプロイ race 対策: ng_words 列が無ければ inline ensure
let _tableEnsured = false;
async function ensureTable(pool) {
  if (_tableEnsured) return;
  try {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ng_words' LIMIT 1`
    );
    if (rows.length === 0) {
      await pool.query(
        `CREATE TABLE ng_words (
           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           field VARCHAR(50) NOT NULL,
           word VARCHAR(255) NOT NULL,
           enabled TINYINT(1) NOT NULL DEFAULT 1,
           memo VARCHAR(255) DEFAULT NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           UNIQUE KEY uk_ng_words_field_word (field, word),
           INDEX idx_ng_words_field_enabled (field, enabled)
         ) ENGINE=InnoDB COMMENT='リスト抽出 NGワード (部分一致で除外)'`
      );
      console.log('[ngWordService] ng_words テーブル 自動作成 完了');
    }
    _tableEnsured = true;
  } catch (e) {
    console.error('[ngWordService] ng_words ensure 失敗:', e.message);
  }
}

function assertField(field) {
  if (!VALID_FIELDS.has(field)) {
    const e = new Error(`不正な field: ${field}`);
    e.status = 400; e.code = 'INVALID_FIELD'; throw e;
  }
}

async function list() {
  const pool = getPool();
  if (!pool) return [];
  await ensureTable(pool);
  const [rows] = await pool.query(
    `SELECT id, field, word, enabled, memo, created_at, updated_at
       FROM ng_words
      ORDER BY field ASC, word ASC`
  );
  return rows;
}

async function create({ field, word, memo, enabled = 1 }) {
  assertField(field);
  if (!word || !String(word).trim()) {
    const e = new Error('word は必須'); e.status = 400; e.code = 'INVALID_INPUT'; throw e;
  }
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  const w = String(word).trim();
  try {
    const [r] = await pool.query(
      `INSERT INTO ng_words (field, word, enabled, memo) VALUES (?, ?, ?, ?)`,
      [field, w, enabled ? 1 : 0, memo || null]
    );
    return { id: r.insertId, field, word: w, enabled: enabled ? 1 : 0, memo: memo || null };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const err = new Error(`「${field}」 に NGワード 「${w}」 は既に登録済みです`);
      err.status = 409; err.code = 'DUPLICATE'; throw err;
    }
    throw e;
  }
}

async function update(id, { enabled, memo }) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  const sets = [];
  const params = [];
  if (enabled !== undefined) { sets.push('enabled = ?'); params.push(enabled ? 1 : 0); }
  if (memo !== undefined)    { sets.push('memo = ?');    params.push(memo || null); }
  if (!sets.length) return false;
  params.push(id);
  const [r] = await pool.query(`UPDATE ng_words SET ${sets.join(', ')} WHERE id = ?`, params);
  return r.affectedRows > 0;
}

async function remove(id) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  const [r] = await pool.query(`DELETE FROM ng_words WHERE id = ?`, [id]);
  return r.affectedRows > 0;
}

/**
 * 有効なNGワードを field 単位でまとめて取得 → SQL WHERE 断片を組み立て
 *   返り値: { sql: '...', params: [...] } または null (NGワード無しの場合)
 *
 *   sql 例 (column prefix なし):
 *     `(company_name IS NULL OR (company_name NOT LIKE ? AND company_name NOT LIKE ?))
 *      AND (industry IS NULL OR (industry NOT LIKE ?))
 *      ...`
 *
 *   注意: customers の各列が NULL のときも除外しない (NULL は LIKE で false になる)
 *         ため IS NULL 分岐を入れる
 */
async function buildNgWordWhereClause(tableAlias) {
  const pool = getPool();
  if (!pool) return null;
  await ensureTable(pool);
  const [rows] = await pool.query(
    `SELECT field, word FROM ng_words WHERE enabled = 1`
  );
  if (!rows.length) return null;

  const prefix = tableAlias ? `${tableAlias}.` : '';
  const byField = new Map();
  for (const r of rows) {
    if (!VALID_FIELDS.has(r.field)) continue;
    if (!byField.has(r.field)) byField.set(r.field, []);
    byField.get(r.field).push(r.word);
  }
  if (byField.size === 0) return null;

  const clauses = [];
  const params = [];
  for (const [field, words] of byField) {
    const col = `${prefix}${field}`;
    const notLikes = words.map(() => `${col} NOT LIKE ?`).join(' AND ');
    for (const w of words) params.push(`%${w}%`);
    // NULL は ヒットしない扱い (除外しない) → IS NULL OR ( ... )
    clauses.push(`(${col} IS NULL OR (${notLikes}))`);
  }
  return { sql: clauses.join(' AND '), params };
}

module.exports = {
  VALID_FIELDS,
  list,
  create,
  update,
  remove,
  buildNgWordWhereClause,
};
