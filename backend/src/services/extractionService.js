const ExcelJS = require('exceljs');
const { getPool, isConfigured } = require('../../config/db');
const drive = require('./driveService');
const ngWordService = require('./ngWordService');

// Railway デプロイ race 対策: is_test 列が無ければ ALTER で追加 (1度成功すれば no-op)
let _isTestColumnEnsured = false;
async function ensureIsTestColumn(pool) {
  if (_isTestColumnEnsured) return;
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'extraction_batches'
          AND COLUMN_NAME = 'is_test'`
    );
    if (rows.length === 0) {
      await pool.query(
        `ALTER TABLE extraction_batches
           ADD COLUMN is_test TINYINT(1) NOT NULL DEFAULT 0
             COMMENT 'テストモード抽出: 顧客マスタの送信履歴を更新しない'`
      );
      console.log('[extractionService] extraction_batches.is_test 列 自動追加 完了');
    }
    _isTestColumnEnsured = true;
  } catch (e) {
    console.error('[extractionService] is_test 列 ensure 失敗:', e.message);
  }
}

// 抽出履歴カウント (extract_count) 列の自動追加 — リスト抽出時の優先度算出に使用
let _extractCountEnsured = false;
async function ensureExtractCountColumn(pool) {
  if (_extractCountEnsured) return;
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'customers'
          AND COLUMN_NAME = 'extract_count'`
    );
    if (rows.length === 0) {
      await pool.query(
        `ALTER TABLE customers
           ADD COLUMN extract_count INT NOT NULL DEFAULT 0
             COMMENT 'リスト抽出された累計回数。 少ない方が優先抽出される',
           ADD INDEX idx_customers_extract_count (extract_count)`
      );
      console.log('[extractionService] customers.extract_count 列 + index 自動追加 完了');
    }
    _extractCountEnsured = true;
  } catch (e) {
    console.error('[extractionService] extract_count 列 ensure 失敗:', e.message);
  }
}

function buildWhere({ industry, prefecture, recentDays, recentCallDays, excludeProjects, maxExtractCount, ngWordClause }) {
  // 抽出条件:
  //   - ブラックリスト除外
  //   - FAX 番号必須 (callcenter由来等のFAX無し顧客は対象外)
  //   - REGEXP_REPLACE で全角ハイフン/空白を除いた数字のみ残して 1文字以上 (= 実質的にFAX番号がある)
  const where = [
    'is_blacklisted = 0',
    'fax_number IS NOT NULL',
    "fax_number <> ''",
    "REGEXP_REPLACE(fax_number, '[^0-9]', '') <> ''",
  ];
  const params = [];
  // 業種フィルタ: 9カテゴリ (飲食/製造/小売/宿泊/建設/農業/介護/運送/その他) → industry_category 列で絞る
  //   旧仕様で 詳細業種(製造業 等) を渡してきた場合のフォールバックも入れる
  if (industry) {
    where.push('(industry_category = ? OR industry = ?)');
    params.push(industry, industry);
  }
  // prefecture: 単一文字列 / 配列 / カンマ区切り文字列 のいずれも受け付ける
  if (prefecture) {
    const list = Array.isArray(prefecture)
      ? prefecture
      : String(prefecture).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 1) {
      where.push('prefecture = ?');
      params.push(list[0]);
    } else if (list.length > 1) {
      where.push('prefecture IN (?)');
      params.push(list);
    }
  }
  if (recentDays && Number(recentDays) > 0) {
    where.push('(last_sent_at IS NULL OR last_sent_at < (NOW() - INTERVAL ? DAY))');
    params.push(Number(recentDays));
  }
  // N 日以内に架電 (call channel イベント) があった顧客を除外
  //   contact_events.channel = 'call' (callcenter / 受電報告 由来) の
  //   occurred_at が直近 N 日以内 なら除外
  if (recentCallDays && Number(recentCallDays) > 0) {
    where.push(`id NOT IN (
      SELECT DISTINCT customer_id FROM contact_events
       WHERE channel = 'call'
         AND occurred_at >= (NOW() - INTERVAL ? DAY)
    )`);
    params.push(Number(recentCallDays));
  }
  // 既存案件 (sales_projects + job_postings) と company_name 一致の顧客を除外
  //   いずれのテーブルも customer_id を持たないため text 完全一致で照合
  if (excludeProjects) {
    where.push(`company_name NOT IN (
      SELECT company_name FROM sales_projects
       WHERE company_name IS NOT NULL AND company_name <> ''
      UNION
      SELECT company_name FROM job_postings
       WHERE company_name IS NOT NULL AND company_name <> ''
    )`);
  }
  // 抽出履歴が N 回以上の顧客を除外 (0 = 除外しない)
  //   extract_count >= N の行を除く
  if (maxExtractCount && Number(maxExtractCount) > 0) {
    where.push('COALESCE(extract_count, 0) < ?');
    params.push(Number(maxExtractCount));
  }
  // NGワード (会社名/業種/住所/備考/URL/代表者 の部分一致でヒットしたら除外)
  if (ngWordClause && ngWordClause.sql) {
    where.push(`(${ngWordClause.sql})`);
    params.push(...(ngWordClause.params || []));
  }
  return { whereSql: 'WHERE ' + where.join(' AND '), params };
}

// 抽出優先順位 — 「抽出履歴が少ない企業ほど優先」 ルール
//   1. extract_count ASC  — 過去に抽出された回数が少ない (= 0回 → 1回 → 2回 ...)
//   2. send_count   ASC  — 同点なら 送信回数が少ない方
//   3. last_sent_at      — 同点なら 未送信 (NULL) → 最古順
//   4. id ASC            — 完全タイブレーク
const PRIORITY_ORDER = `
  ORDER BY extract_count ASC,
           send_count ASC,
           last_sent_at IS NULL DESC,
           last_sent_at ASC,
           id ASC
`;

/**
 * 抽出条件に合致する顧客の総数(プレビュー用)
 */
async function previewCount(filters = {}) {
  const pool = getPool();
  if (!pool) return { matchCount: 0 };
  // boolean は文字列で来る (query string) ので正規化
  const ngWordClause = await ngWordService.buildNgWordWhereClause();
  const normalized = {
    ...filters,
    excludeProjects: filters.excludeProjects === true || filters.excludeProjects === 'true' || filters.excludeProjects === '1',
    maxExtractCount: Number(filters.maxExtractCount) || 0,  // 0 = 除外しない
    ngWordClause,
  };
  const { whereSql, params } = buildWhere(normalized);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM customers ${whereSql}`,
    params
  );
  return { matchCount: rows[0].cnt };
}

/**
 * 抽出を確定実行: バッチを作成し、customer集計を更新する。
 * 1トランザクションで:
 *   1. extraction_batches に INSERT
 *   2. 条件 + LIMIT で顧客を取得
 *   3. extraction_records に bulk INSERT
 *   4. customers の send_count++, last_sent_at, last_pc_number を更新
 *   5. batch.actual_count を更新
 */
async function createBatch({ name, industry, prefecture, recentDays, recentCallDays, excludeProjects, maxExtractCount, targetCount, pcNumber, testMode }) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です。.env の DB_HOST 等を設定してください');
    err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!name || !targetCount || targetCount <= 0) {
    const err = new Error('バッチ名と件数は必須です');
    err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }

  const pool = getPool();
  await ensureIsTestColumn(pool);
  await ensureExtractCountColumn(pool);
  const isTest = !!testMode;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. batch 行を作成
    const [batchInsert] = await conn.query(
      `INSERT INTO extraction_batches
         (name, filter_industry, filter_prefecture, filter_recent_days, target_count, pc_number, status, is_test)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
      [name, industry || null, prefecture || null, recentDays || null, targetCount, pcNumber || null, isTest ? 1 : 0]
    );
    const batchId = batchInsert.insertId;

    // 2. 該当顧客を選定 (FOR UPDATE で同時実行時の二重取得を防止)
    const ngWordClause = await ngWordService.buildNgWordWhereClause();
    const { whereSql, params } = buildWhere({ industry, prefecture, recentDays, recentCallDays, excludeProjects, maxExtractCount, ngWordClause });
    const [customers] = await conn.query(
      `SELECT id FROM customers ${whereSql} ${PRIORITY_ORDER} LIMIT ? FOR UPDATE`,
      [...params, Number(targetCount)]
    );

    if (!customers.length) {
      await conn.query(
        `UPDATE extraction_batches SET actual_count = 0, status = 'failed' WHERE id = ?`,
        [batchId]
      );
      await conn.commit();
      return { batchId, actualCount: 0, status: 'failed', isTest };
    }

    // 3. extraction_records にバルクINSERT (テストモードでもリスト/Excel 出力のため記録)
    const recordRows = customers.map((c, i) => [batchId, c.id, i + 1]);
    await conn.query(
      `INSERT INTO extraction_records (batch_id, customer_id, row_index) VALUES ?`,
      [recordRows]
    );

    // 4. customers の集計更新 (送信回数 + 最終送信日時 + 最終PC)
    //    テストモードではスキップ — 顧客マスタに履歴を残さない
    if (!isTest) {
      const ids = customers.map((c) => c.id);
      await conn.query(
        `UPDATE customers
            SET send_count = send_count + 1,
                extract_count = COALESCE(extract_count, 0) + 1,
                last_sent_at = NOW(),
                last_pc_number = ?
          WHERE id IN (?)`,
        [pcNumber || null, ids]
      );
    }

    // 5. batch.actual_count を更新
    await conn.query(
      `UPDATE extraction_batches SET actual_count = ? WHERE id = ?`,
      [customers.length, batchId]
    );

    await conn.commit();
    return { batchId, actualCount: customers.length, status: 'ready', isTest };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 複数 PC 同時抽出 (重複ゼロ保証)
 *   targetCount × pcNumbers.length 件を 1トランザクションで FOR UPDATE 取得し、
 *   各 PC のバッチに連続スライスして割り当てる。
 *   データ不足時は前の PC から優先的に埋め、余った PC は actual_count=0 / status='failed'。
 *
 *   返り値: [{ pcNumber, batchId, actualCount, status }, ...] (pcNumbers と同順)
 */
async function createBatchesPerPc({
  baseName, date, industry, prefecture, recentDays, recentCallDays, excludeProjects, maxExtractCount, targetCount, pcNumbers, testMode,
}) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!targetCount || targetCount <= 0) {
    const err = new Error('targetCount (1以上) が必要'); err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }
  if (!Array.isArray(pcNumbers) || !pcNumbers.length) {
    const err = new Error('pcNumbers (配列) が必要'); err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }

  const pool = getPool();
  await ensureIsTestColumn(pool);
  await ensureExtractCountColumn(pool);
  const isTest = !!testMode;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. 全 PC 分の顧客を 一括取得
    const totalWant = Number(targetCount) * pcNumbers.length;
    const ngWordClause = await ngWordService.buildNgWordWhereClause();
    const { whereSql, params } = buildWhere({ industry, prefecture, recentDays, recentCallDays, excludeProjects, maxExtractCount, ngWordClause });
    const [customers] = await conn.query(
      `SELECT id FROM customers ${whereSql} ${PRIORITY_ORDER} LIMIT ? FOR UPDATE`,
      [...params, totalWant]
    );
    const allIds = customers.map((c) => c.id);

    // 2. PC ごとにスライスして バッチ作成 + extraction_records 投入
    const results = [];
    let offset = 0;
    for (const pcRaw of pcNumbers) {
      const pcNum = Number(pcRaw);
      const slice = allIds.slice(offset, offset + Number(targetCount));
      offset += Number(targetCount);

      const testSuffix = isTest ? '_TEST' : '';
      const name = `${baseName || 'リスト'}${testSuffix}_${date}_PC${String(pcNum).padStart(2, '0')}`;
      const [batchInsert] = await conn.query(
        `INSERT INTO extraction_batches
           (name, filter_industry, filter_prefecture, filter_recent_days, target_count, pc_number, status, is_test)
         VALUES (?, ?, ?, ?, ?, ?, 'ready', ?)`,
        [name, industry || null, prefecture || null, recentDays || null,
         Number(targetCount), `NO.${pcNum}`, isTest ? 1 : 0]
      );
      const batchId = batchInsert.insertId;

      if (slice.length > 0) {
        const recordRows = slice.map((cid, i) => [batchId, cid, i + 1]);
        await conn.query(
          `INSERT INTO extraction_records (batch_id, customer_id, row_index) VALUES ?`,
          [recordRows]
        );
        // テストモードでは customers の集計更新をスキップ (顧客マスタに履歴を残さない)
        if (!isTest) {
          await conn.query(
            `UPDATE customers
                SET send_count = send_count + 1,
                    last_sent_at = NOW(),
                    last_pc_number = ?
              WHERE id IN (?)`,
            [`NO.${pcNum}`, slice]
          );
        }
      }

      const status = slice.length > 0 ? 'ready' : 'failed';
      await conn.query(
        `UPDATE extraction_batches SET actual_count = ?, status = ? WHERE id = ?`,
        [slice.length, status, batchId]
      );

      results.push({ pcNumber: pcNum, batchId, actualCount: slice.length, status, isTest });
    }

    await conn.commit();
    return results;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function listBatches({ page = 1, pageSize = 50 } = {}) {
  const pool = getPool();
  if (!pool) return { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };
  await ensureIsTestColumn(pool);
  await ensureExtractCountColumn(pool);
  const limit = Math.min(Number(pageSize) || 50, 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const [rows] = await pool.query(
    `SELECT id, name, filter_industry, filter_prefecture, target_count, actual_count,
            pc_number, status, is_test, drive_file_url, created_at
       FROM extraction_batches
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM extraction_batches`);
  const total = cnt[0].total;
  return {
    items: rows,
    pagination: { page: Number(page) || 1, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function getBatchWithCustomers(id) {
  const pool = getPool();
  if (!pool) return null;
  const [bRows] = await pool.query(`SELECT * FROM extraction_batches WHERE id = ?`, [id]);
  if (!bRows.length) return null;
  const [cRows] = await pool.query(
    `SELECT er.row_index, c.id, c.company_name, c.fax_number, c.phone_number,
            c.industry, c.prefecture, c.city, c.address,
            c.url, c.send_count, COALESCE(c.extract_count, 0) AS extract_count,
            c.note, c.is_blacklisted
       FROM extraction_records er
       JOIN customers c ON c.id = er.customer_id
      WHERE er.batch_id = ?
      ORDER BY er.row_index ASC`,
    [id]
  );
  return { batch: bRows[0], customers: cRows };
}

/**
 * Excel ファイルを生成して Buffer で返す。
 * 構成 (1行目=ヘッダで開始、 No. 列なし):
 *   行1   : ヘッダー (オートフィルタ + 固定)
 *   行2〜  : データ (ゼブラ + ブラックリスト赤背景)
 */
async function generateExcelBuffer(id) {
  const data = await getBatchWithCustomers(id);
  if (!data) return null;
  const { batch, customers } = data;

  const COLUMN_DEFS = [
    { header: '会社名',     key: 'company_name', width: 36, align: 'left'   },
    { header: 'FAX番号',    key: 'fax_number',   width: 16, align: 'left',   font: 'mono' },
    { header: '電話番号',   key: 'phone_number', width: 16, align: 'left',   font: 'mono' },
    { header: '業種',       key: 'industry',     width: 16, align: 'left'   },
    { header: '都道府県',   key: 'prefecture',   width: 10, align: 'left'   },
    { header: '市区町村',   key: 'city',         width: 16, align: 'left'   },
    { header: '住所',       key: 'address',      width: 40, align: 'left'   },
    { header: 'URL',        key: 'url',          width: 24, align: 'left',   link: true },
    { header: '抽出履歴',   key: 'extract_count', width:  8, align: 'right'  },
    { header: '送信履歴',   key: 'send_count',   width:  8, align: 'right'  },
    { header: '備考',       key: 'note',         width: 24, align: 'left'   },
  ];
  const COL_COUNT = COLUMN_DEFS.length;
  const HEADER_ROW = 1;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FAX-CRM';
  wb.created = new Date();
  wb.title = batch.name || `batch_${id}`;
  wb.description = 'FAX送信リスト';

  const ws = wb.addWorksheet('FAXリスト', {
    properties: { defaultRowHeight: 18 },
    views: [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROW }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { top: 0.5, bottom: 0.5, left: 0.4, right: 0.4, header: 0.3, footer: 0.3 },
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
  });

  // 列幅とキー(列定義)
  COLUMN_DEFS.forEach((def, i) => {
    const col = ws.getColumn(i + 1);
    col.width = def.width;
    col.key = def.key;
  });

  // ===== ヘッダー行 =====
  const headerRow = ws.getRow(HEADER_ROW);
  COLUMN_DEFS.forEach((def, i) => {
    headerRow.getCell(i + 1).value = def.header;
  });
  headerRow.height = 24;
  headerRow.font = { name: 'Yu Gothic', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.eachCell((cell) => {
    cell.border = {
      top:    { style: 'medium', color: { argb: 'FF312E81' } },
      bottom: { style: 'medium', color: { argb: 'FF312E81' } },
    };
  });
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to:   { row: HEADER_ROW, column: COL_COUNT },
  };

  // ===== データ行 =====
  customers.forEach((c, idx) => {
    const rowIdx = HEADER_ROW + 1 + idx;
    COLUMN_DEFS.forEach((def, ci) => {
      const cell = ws.getCell(rowIdx, ci + 1);
      const val = c[def.key];
      if (def.link && val) {
        cell.value = { text: val, hyperlink: val };
        cell.font = { name: 'Yu Gothic', color: { argb: 'FF2563EB' }, underline: true, size: 10 };
      } else {
        cell.value = val == null ? '' : val;
        cell.font = {
          name: def.font === 'mono' ? 'Consolas' : 'Yu Gothic',
          size: 10,
          color: { argb: 'FF1F2937' },
        };
      }
      cell.alignment = {
        vertical: 'middle',
        horizontal: def.align || 'left',
        wrapText: def.key === 'address' || def.key === 'note',
      };
      cell.border = {
        top:    { style: 'hair', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
        left:   { style: 'hair', color: { argb: 'FFF3F4F6' } },
        right:  { style: 'hair', color: { argb: 'FFF3F4F6' } },
      };
    });
    // ゼブラ / ブラックリストハイライト
    if (c.is_blacklisted) {
      ws.getRow(rowIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    } else if (idx % 2 === 1) {
      ws.getRow(rowIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  const safeName = (batch.name || `batch_${id}`).replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${safeName}_${formatDate(batch.created_at)}.xlsx`;
  return { buffer: Buffer.from(buffer), fileName };
}

function formatDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatDateLong(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const h = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${y}年${Number(m)}月${Number(day)}日 ${h}:${mi}`;
}

/**
 * バッチ削除
 *   - extraction_records は ON DELETE CASCADE で自動削除される
 *   - incoming_call_reports.batch_id は ON DELETE SET NULL で受電履歴は残る
 *   - Drive 上の Excel ファイル (extraction_batches.drive_file_id) は:
 *       * 同じ drive_file_id が manuscript_slot_files にも記録 (= extract-and-upload で
 *         スロットに格納したケース) → スロット側に管理を任せて削除しない
 *       * スロット非紐づき (= 単独 /upload-to-drive で日付フォルダに保存したケース)
 *         → drive.deleteFile で削除 (permanent delete 優先)
 */
async function deleteBatch(id) {
  const pool = getPool();
  if (!pool) return { deleted: 0, drive: null };

  const [batchRows] = await pool.query(
    'SELECT id, drive_file_id FROM extraction_batches WHERE id = ?',
    [id]
  );
  if (!batchRows.length) return { deleted: 0, drive: null };
  const batch = batchRows[0];

  let driveResult = null;
  if (batch.drive_file_id) {
    try {
      const [shared] = await pool.query(
        'SELECT 1 FROM manuscript_slot_files WHERE drive_file_id = ? LIMIT 1',
        [batch.drive_file_id]
      );
      if (shared.length) {
        driveResult = {
          ok: true,
          deleted: false,
          note: 'スロット格納と共有のため Drive 上は削除せず',
        };
      } else {
        const r = await drive.deleteFile(batch.drive_file_id);
        driveResult = { ok: true, deleted: true, mode: r.mode };
      }
    } catch (e) {
      driveResult = { ok: false, error: e.message };
      console.error('[deleteBatch] Drive 削除失敗:', e.message);
    }
  }

  const [r] = await pool.query('DELETE FROM extraction_batches WHERE id = ?', [id]);
  return { deleted: r.affectedRows, drive: driveResult };
}

module.exports = {
  previewCount,
  createBatch,
  createBatchesPerPc,
  listBatches,
  getBatchWithCustomers,
  generateExcelBuffer,
  deleteBatch,
};
