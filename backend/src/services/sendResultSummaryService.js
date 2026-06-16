/**
 * 送信結果集計サービス
 *   期間 (folder_date 基準) で、 地域 × 業種 × 原稿国籍 別に
 *   「送信先数 / 受電数 / 受電率 / 案件化数 / 案件化率」 を集計。
 *
 * 「いつ送ったか」 の判定:
 *   contact_events で channel='fax' AND event_type='send' のレコードを
 *   送信1回とみなす。 manuscript_folder_date が 抽出時に格納された
 *   スロットの日付 (= Drive フォルダ名の日付)。
 *
 * 「受電」 の判定:
 *   同じ customer に対して 抽出日 (manuscript_folder_date) 以降に
 *   contact_events.channel='call' レコードがあれば 受電あり。
 *
 * 「案件化」 の判定:
 *   sales_projects.company_name = customers.company_name で、
 *   acquired_date >= 抽出日 ならカウント。
 */
const { getPool } = require('../../config/db');

// prefecture → region マッピング (CASE 式)
//   prefectures.js の REGIONS と同じ定義を SQL に展開
const REGION_CASE = `
  CASE
    WHEN c.prefecture = '北海道' THEN '北海道'
    WHEN c.prefecture IN ('青森県','岩手県','宮城県','秋田県','山形県','福島県') THEN '東北'
    WHEN c.prefecture IN ('茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県') THEN '関東'
    WHEN c.prefecture IN ('新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県') THEN '中部'
    WHEN c.prefecture IN ('三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県') THEN '近畿'
    WHEN c.prefecture IN ('鳥取県','島根県','岡山県','広島県','山口県') THEN '中国'
    WHEN c.prefecture IN ('徳島県','香川県','愛媛県','高知県') THEN '四国'
    WHEN c.prefecture IN ('福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県') THEN '九州'
    ELSE '(未設定)'
  END
`;

const REGION_ORDER = ['北海道','東北','関東','中部','近畿','中国','四国','九州','(未設定)'];

/**
 * 送信結果サマリを取得
 *   @param from YYYY-MM-DD (含む)
 *   @param to   YYYY-MM-DD (含む)
 *   @param groupBy 'region' | 'industry' | 'nationality' | 'region+industry' | 'region+industry+nationality' (default)
 */
async function summary({ from, to, groupBy = 'region+industry+nationality' } = {}) {
  const pool = getPool();
  if (!pool) return { rows: [], totals: emptyTotals(), from, to, groupBy };
  if (!from || !to) {
    const err = new Error('from / to (YYYY-MM-DD) は必須'); err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }

  // groupBy で SELECT / GROUP BY を組み立て
  //   region と industry_category と nationality を任意に組み合わせ
  const axes = parseGroupBy(groupBy);
  const selectCols = [];
  const groupCols = [];
  if (axes.region)      { selectCols.push(`${REGION_CASE} AS region`);      groupCols.push('region'); }
  if (axes.industry)    { selectCols.push(`COALESCE(c.industry_category, '(未設定)') AS industry_category`); groupCols.push('industry_category'); }
  if (axes.nationality) { selectCols.push(`COALESCE(mc.nationality, '(未設定)') AS nationality`); groupCols.push('nationality'); }

  const groupClause = groupCols.length ? `GROUP BY ${groupCols.join(', ')}` : '';
  const orderClause = groupCols.length
    ? `ORDER BY ${groupCols.map((c) => `${c}`).join(', ')}`
    : '';

  // 主クエリ:
  //   contact_events から fax/send レコードを取得 (= 1 送信 = 1 行)
  //   customer × 抽出日 で 受電・案件化を EXISTS で判定
  //   GROUP BY で集計
  const sql = `
    SELECT
      ${selectCols.join(',\n      ')}${selectCols.length ? ',' : ''}
      COUNT(*) AS sent,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM contact_events ce2
         WHERE ce2.customer_id = ce.customer_id
           AND ce2.channel = 'call'
           AND ce2.occurred_at >= ce.manuscript_folder_date
      ) THEN 1 ELSE 0 END) AS called,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM sales_projects sp
         WHERE sp.company_name = c.company_name
           AND sp.acquired_date >= ce.manuscript_folder_date
      ) THEN 1 ELSE 0 END) AS projects
    FROM contact_events ce
    LEFT JOIN customers c ON c.id = ce.customer_id
    LEFT JOIN manuscript_slot_files msf
      ON msf.manuscript_id = ce.manuscript_id
     AND msf.manuscript_content_id IS NOT NULL
    LEFT JOIN manuscript_contents mc ON mc.id = msf.manuscript_content_id
    WHERE ce.channel = 'fax'
      AND ce.event_type = 'send'
      AND ce.manuscript_folder_date BETWEEN ? AND ?
    ${groupClause}
    ${orderClause}
    LIMIT 5000
  `;

  const [rows] = await pool.query(sql, [from, to]);

  // 集計 (全体)
  const totals = { sent: 0, called: 0, projects: 0 };
  for (const r of rows) {
    totals.sent += Number(r.sent) || 0;
    totals.called += Number(r.called) || 0;
    totals.projects += Number(r.projects) || 0;
  }
  totals.callRate = totals.sent > 0 ? totals.called / totals.sent * 100 : 0;
  totals.projectRate = totals.sent > 0 ? totals.projects / totals.sent * 100 : 0;

  // 各行に率を付与
  const enriched = rows.map((r) => ({
    region: r.region,
    industry_category: r.industry_category,
    nationality: r.nationality,
    sent: Number(r.sent) || 0,
    called: Number(r.called) || 0,
    projects: Number(r.projects) || 0,
    callRate: r.sent > 0 ? Number(r.called) / Number(r.sent) * 100 : 0,
    projectRate: r.sent > 0 ? Number(r.projects) / Number(r.sent) * 100 : 0,
  }));

  // region 軸が含まれる場合は 関東/近畿 等の順序でソート
  if (axes.region) {
    enriched.sort((a, b) => {
      const ra = REGION_ORDER.indexOf(a.region);
      const rb = REGION_ORDER.indexOf(b.region);
      if (ra !== rb) return ra - rb;
      const ia = (a.industry_category || '').localeCompare(b.industry_category || '');
      if (ia !== 0) return ia;
      return (a.nationality || '').localeCompare(b.nationality || '');
    });
  }

  return { rows: enriched, totals, from, to, groupBy, axes };
}

function parseGroupBy(s) {
  const set = new Set(String(s || '').split('+').map((t) => t.trim().toLowerCase()).filter(Boolean));
  return {
    region: set.has('region'),
    industry: set.has('industry'),
    nationality: set.has('nationality'),
  };
}

function emptyTotals() {
  return { sent: 0, called: 0, projects: 0, callRate: 0, projectRate: 0 };
}

module.exports = { summary };
