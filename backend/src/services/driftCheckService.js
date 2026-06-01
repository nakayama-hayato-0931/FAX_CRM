/**
 * Phase 3a: 顧客マスタのドリフト検出
 *   - fax-crm.customers と callcenter.companies の整合性を比較
 *   - 不一致が増えていく傾向があれば shadow write の取りこぼし → 差分バックフィルで回収
 */
const { getPool: getFaxPool } = require('../../config/db');
const ccDb = require('../../config/callcenterDb');

async function runDriftCheck({ sampleSize = 100 } = {}) {
  const faxPool = getFaxPool();
  const ccPool = ccDb.getPool();
  if (!faxPool || !ccPool) {
    return { ok: false, reason: 'DB 未設定' };
  }

  const report = {
    timestamp: new Date().toISOString(),
    fax_crm: {},
    callcenter: {},
    drift: {},
    sample_mismatches: [],
  };

  // ① 件数比較
  const [[faxAll]] = await faxPool.query('SELECT COUNT(*) AS n FROM customers');
  const [[faxLinked]] = await faxPool.query(
    'SELECT COUNT(*) AS n FROM customers WHERE external_callcenter_id IS NOT NULL'
  );
  const [[faxUnlinked]] = await faxPool.query(
    'SELECT COUNT(*) AS n FROM customers WHERE external_callcenter_id IS NULL'
  );
  report.fax_crm.total = faxAll.n;
  report.fax_crm.linked = faxLinked.n;
  report.fax_crm.unlinked = faxUnlinked.n;

  const [[ccAll]] = await ccPool.query('SELECT COUNT(*) AS n FROM companies');
  const [[ccLinked]] = await ccPool.query(
    'SELECT COUNT(*) AS n FROM companies WHERE external_faxcrm_id IS NOT NULL'
  );
  const [[ccExt]] = await ccPool.query('SELECT COUNT(*) AS n FROM fax_customer_ext');
  report.callcenter.total = ccAll.n;
  report.callcenter.linked = ccLinked.n;
  report.callcenter.fax_ext_rows = ccExt.n;

  // ② linked 件数の差 (理想は 0)
  report.drift.linked_diff = Math.abs(report.fax_crm.linked - report.callcenter.linked);
  report.drift.ext_diff = Math.abs(report.fax_crm.linked - report.callcenter.fax_ext_rows);
  report.drift.unlinked_in_faxcrm = report.fax_crm.unlinked;
  // unlinked が大きい = シャドー書きの取りこぼし or 古い顧客 (Phase 1 以前に作成)

  // ③ サンプル比較 (fax-crm から N件取って callcenter 側の値と突き合わせ)
  const [samples] = await faxPool.query(
    `SELECT id, company_name, fax_number, phone_number, is_blacklisted, external_callcenter_id
       FROM customers WHERE external_callcenter_id IS NOT NULL
       ORDER BY RAND() LIMIT ?`,
    [Math.min(sampleSize, 500)]
  );
  let consistent = 0;
  let mismatched = 0;
  for (const f of samples) {
    const [ccRows] = await ccPool.query(
      `SELECT id, company_name, fax_number, phone_number, is_blacklisted, external_faxcrm_id
         FROM companies WHERE id = ? LIMIT 1`,
      [f.external_callcenter_id]
    );
    const c = ccRows[0];
    if (!c) {
      mismatched++;
      if (report.sample_mismatches.length < 10) {
        report.sample_mismatches.push({
          fax_id: f.id,
          callcenter_id: f.external_callcenter_id,
          issue: 'callcenter 側に行が無い',
        });
      }
      continue;
    }
    const diffs = [];
    if ((f.company_name || '') !== (c.company_name || '')) diffs.push({ field: 'company_name', fax: f.company_name, cc: c.company_name });
    if ((f.fax_number || '') !== (c.fax_number || '')) diffs.push({ field: 'fax_number', fax: f.fax_number, cc: c.fax_number });
    if ((f.phone_number || '') !== (c.phone_number || '')) diffs.push({ field: 'phone_number', fax: f.phone_number, cc: c.phone_number });
    if (Number(f.is_blacklisted || 0) !== Number(c.is_blacklisted || 0)) diffs.push({ field: 'is_blacklisted', fax: f.is_blacklisted, cc: c.is_blacklisted });
    if (Number(c.external_faxcrm_id || 0) !== Number(f.id)) diffs.push({ field: 'external_faxcrm_id', fax: f.id, cc: c.external_faxcrm_id });
    if (diffs.length > 0) {
      mismatched++;
      if (report.sample_mismatches.length < 10) {
        report.sample_mismatches.push({ fax_id: f.id, callcenter_id: c.id, diffs });
      }
    } else {
      consistent++;
    }
  }
  report.drift.sample_consistent = consistent;
  report.drift.sample_mismatched = mismatched;
  report.drift.sample_size = samples.length;
  report.drift.sample_consistency_rate = samples.length > 0
    ? Math.round((consistent / samples.length) * 1000) / 10
    : null;

  // ④ ステータス判定
  if (report.drift.linked_diff === 0 && report.drift.sample_mismatched === 0) {
    report.status = 'healthy';
  } else if (report.drift.linked_diff < 100 && report.drift.sample_consistency_rate >= 95) {
    report.status = 'minor_drift';
  } else {
    report.status = 'drift_detected';
  }

  return { ok: true, ...report };
}

module.exports = { runDriftCheck };
