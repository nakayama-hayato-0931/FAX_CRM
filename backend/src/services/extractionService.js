const ExcelJS = require('exceljs');
const { getPool, isConfigured } = require('../../config/db');
const drive = require('./driveService');

function buildWhere({ industry, prefecture, recentDays }) {
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
  // 業種フィルタ: 6カテゴリ (飲食/製造/小売/宿泊/建設/その他) → industry_category 列で絞る
  //   旧仕様で 詳細業種(製造業 等) を渡してきた場合のフォールバックも入れる
  if (industry) {
    where.push('(industry_category = ? OR industry = ?)');
    params.push(industry, industry);
  }
  if (prefecture) { where.push('prefecture = ?'); params.push(prefecture); }
  if (recentDays && Number(recentDays) > 0) {
    where.push('(last_sent_at IS NULL OR last_sent_at < (NOW() - INTERVAL ? DAY))');
    params.push(Number(recentDays));
  }
  return { whereSql: 'WHERE ' + where.join(' AND '), params };
}

const PRIORITY_ORDER = `
  ORDER BY send_count ASC,
           last_sent_at IS NULL DESC,
           last_sent_at ASC,
           id ASC
`;

/**
 * 抽出条件に合致する顧客の総数(プレビュー用)
 */
async function previewCount(filters) {
  const pool = getPool();
  if (!pool) return { matchCount: 0 };
  const { whereSql, params } = buildWhere(filters);
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
async function createBatch({ name, industry, prefecture, recentDays, targetCount, pcNumber }) {
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. batch 行を作成
    const [batchInsert] = await conn.query(
      `INSERT INTO extraction_batches
         (name, filter_industry, filter_prefecture, filter_recent_days, target_count, pc_number, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ready')`,
      [name, industry || null, prefecture || null, recentDays || null, targetCount, pcNumber || null]
    );
    const batchId = batchInsert.insertId;

    // 2. 該当顧客を選定 (FOR UPDATE で同時実行時の二重取得を防止)
    const { whereSql, params } = buildWhere({ industry, prefecture, recentDays });
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
      return { batchId, actualCount: 0, status: 'failed' };
    }

    // 3. extraction_records にバルクINSERT
    const recordRows = customers.map((c, i) => [batchId, c.id, i + 1]);
    await conn.query(
      `INSERT INTO extraction_records (batch_id, customer_id, row_index) VALUES ?`,
      [recordRows]
    );

    // 4. customers の集計更新 (送信回数 + 最終送信日時 + 最終PC)
    const ids = customers.map((c) => c.id);
    await conn.query(
      `UPDATE customers
          SET send_count = send_count + 1,
              last_sent_at = NOW(),
              last_pc_number = ?
        WHERE id IN (?)`,
      [pcNumber || null, ids]
    );

    // 5. batch.actual_count を更新
    await conn.query(
      `UPDATE extraction_batches SET actual_count = ? WHERE id = ?`,
      [customers.length, batchId]
    );

    await conn.commit();
    return { batchId, actualCount: customers.length, status: 'ready' };
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
  baseName, date, industry, prefecture, recentDays, targetCount, pcNumbers,
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. 全 PC 分の顧客を 一括取得
    const totalWant = Number(targetCount) * pcNumbers.length;
    const { whereSql, params } = buildWhere({ industry, prefecture, recentDays });
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

      const name = `${baseName || 'リスト'}_${date}_PC${String(pcNum).padStart(2, '0')}`;
      const [batchInsert] = await conn.query(
        `INSERT INTO extraction_batches
           (name, filter_industry, filter_prefecture, filter_recent_days, target_count, pc_number, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ready')`,
        [name, industry || null, prefecture || null, recentDays || null,
         Number(targetCount), `NO.${pcNum}`]
      );
      const batchId = batchInsert.insertId;

      if (slice.length > 0) {
        const recordRows = slice.map((cid, i) => [batchId, cid, i + 1]);
        await conn.query(
          `INSERT INTO extraction_records (batch_id, customer_id, row_index) VALUES ?`,
          [recordRows]
        );
        await conn.query(
          `UPDATE customers
              SET send_count = send_count + 1,
                  last_sent_at = NOW(),
                  last_pc_number = ?
            WHERE id IN (?)`,
          [`NO.${pcNum}`, slice]
        );
      }

      const status = slice.length > 0 ? 'ready' : 'failed';
      await conn.query(
        `UPDATE extraction_batches SET actual_count = ?, status = ? WHERE id = ?`,
        [slice.length, status, batchId]
      );

      results.push({ pcNumber: pcNum, batchId, actualCount: slice.length, status });
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
  const limit = Math.min(Number(pageSize) || 50, 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const [rows] = await pool.query(
    `SELECT id, name, filter_industry, filter_prefecture, target_count, actual_count,
            pc_number, status, drive_file_url, created_at
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
            c.url, c.send_count, c.note, c.is_blacklisted
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
 * 構成:
 *   行1   : タイトル (バッチ名)
 *   行2〜5 : メタ情報 (抽出条件 / 件数 / PC / 作成日)
 *   行6   : ヘッダー (オートフィルタ + 固定)
 *   行7〜  : データ (ゼブラ + ブラックリスト赤背景)
 */
async function generateExcelBuffer(id) {
  const data = await getBatchWithCustomers(id);
  if (!data) return null;
  const { batch, customers } = data;

  const COLUMN_DEFS = [
    { header: 'No.',       key: 'row_index',    width:  6, align: 'center' },
    { header: '会社名',     key: 'company_name', width: 36, align: 'left'   },
    { header: 'FAX番号',    key: 'fax_number',   width: 16, align: 'left',   font: 'mono' },
    { header: '電話番号',   key: 'phone_number', width: 16, align: 'left',   font: 'mono' },
    { header: '業種',       key: 'industry',     width: 16, align: 'left'   },
    { header: '都道府県',   key: 'prefecture',   width: 10, align: 'left'   },
    { header: '市区町村',   key: 'city',         width: 16, align: 'left'   },
    { header: '住所',       key: 'address',      width: 40, align: 'left'   },
    { header: 'URL',        key: 'url',          width: 24, align: 'left',   link: true },
    { header: '送信履歴',   key: 'send_count',   width:  8, align: 'right'  },
    { header: '備考',       key: 'note',         width: 24, align: 'left'   },
  ];
  const COL_COUNT = COLUMN_DEFS.length;
  const HEADER_ROW = 6;

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

  // 列幅とキー(列定義) — タイトル領域と共存させるため明示的に
  COLUMN_DEFS.forEach((def, i) => {
    const col = ws.getColumn(i + 1);
    col.width = def.width;
    col.key = def.key;
  });

  // ===== タイトル領域 =====
  const titleColEnd = String.fromCharCode(64 + COL_COUNT);  // A→K等
  ws.mergeCells(`A1:${titleColEnd}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `FAX送信リスト  ${batch.name || ''}`;
  titleCell.font = { name: 'Yu Gothic', bold: true, size: 16, color: { argb: 'FF1E1B4B' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 28;

  const metaRows = [
    ['抽出条件',  `業種: ${batch.filter_industry || '-'} / 都道府県: ${batch.filter_prefecture || '-'}`],
    ['件数',      `${batch.actual_count || customers.length} 件 (目標: ${batch.target_count || '-'})`],
    ['担当PC',    batch.pc_number || '-'],
    ['作成日',    formatDateLong(batch.created_at)],
  ];
  metaRows.forEach((row, idx) => {
    const r = idx + 2;
    ws.mergeCells(`B${r}:${titleColEnd}${r}`);
    const k = ws.getCell(`A${r}`);
    const v = ws.getCell(`B${r}`);
    k.value = row[0];
    v.value = row[1];
    k.font = { name: 'Yu Gothic', bold: true, color: { argb: 'FF6B7280' }, size: 10 };
    v.font = { name: 'Yu Gothic', color: { argb: 'FF1F2937' }, size: 10 };
    k.alignment = v.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(r).height = 16;
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
