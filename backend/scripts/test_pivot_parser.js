#!/usr/bin/env node
/**
 * parsePivotSheet を実データ風の入力で叩いて挙動を検証する。
 * Usage: node scripts/test_pivot_parser.js
 */
const { parsePivotSheet, detectPivotFormat } = require('../src/services/faxStatsService');

// ---- ケース1: 実シート抜粋(NO.1 / NO.2)
const sample = [
  ['合計', '平均', '4/30', '5/1', '5/2', '5/3', '5/4', '5/5', '5/6', '5/7'],
  ['送信件数', '', '', '4548', '4802', '4396', '4728', '4907', '4266', '4775', '4497'],   // NO.1
  ['エラー数', '', '', '998', '3814', '771', '749', '919', '952', '1715', '591'],         // NO.1
  ['送信数合計', '', '', '18474', '6332', '', '', '', '28542', '5564'],                  // skip
  ['', '', '', '139120', '25403'],                                                        // skip
  ['NO.1', '', '', '', '504'],                                                            // marker
  ['総数', '', '45756', '46062', '46370', '46678', '46999', '47308', '47605', '47891'],   // skip
  ['エラー総数', '', '5818', '5836', '5855', '5876', '5892', '5907', '5921', '5947'],     // skip
  ['送信件数', '273', '', '288', '289', '287', '305', '294', '283', '260', '266'],        // NO.2
  ['エラー数', '', '', '18', '19', '21', '16', '15', '14', '26', '26'],                   // NO.2
];

console.log('=== ケース1: 実シート抜粋 (NO.1 / NO.2) ===');
console.log('detectPivotFormat =', detectPivotFormat(sample));
const rows1 = parsePivotSheet(sample, { defaultYear: 2026 });
console.log(`抽出行数: ${rows1.length} (期待: NO.1×7日 + NO.2×7日 = 14)`);
const pc1 = [...new Set(rows1.map((r) => r.pc_number))];
console.log('検出PC:', pc1);

// ---- ケース2: NO.1〜NO.23 まで全部
console.log('\n=== ケース2: NO.1〜NO.23 (23PC) ===');
const PC_COUNT = 23;
const DATES = ['5/1', '5/2', '5/3', '5/4', '5/5', '5/6', '5/7'];
const values23 = [['合計', '平均', ...DATES]];

for (let i = 1; i <= PC_COUNT; i++) {
  // 各PCのデータブロック (header は [合計, 平均, ...DATES] なので、データは列1まで空)
  const sendRow = ['送信件数', ''];
  const errorRow = ['エラー数', ''];
  for (let d = 0; d < DATES.length; d++) {
    sendRow.push(String(300 + i * 10 + d));     // 例: NO.1の5/1=311
    errorRow.push(String(10 + i + (d % 3)));
  }
  values23.push(sendRow);
  values23.push(errorRow);
  values23.push(['送信数合計', '', '12345']);                  // skip
  values23.push(['', '', '']);                                 // skip
  values23.push([`NO.${i}`, '', '', '500']);                   // marker
  if (i < PC_COUNT) {
    values23.push(['総数', '', '1000']);                       // skip
    values23.push(['エラー総数', '', '50']);                   // skip
  }
}

console.log(`入力行数: ${values23.length}`);
const rows23 = parsePivotSheet(values23, { defaultYear: 2026 });
console.log(`抽出行数: ${rows23.length} (期待: 23PC × 7日 = 161)`);
const pcs23 = [...new Set(rows23.map((r) => r.pc_number))];
console.log(`検出PC数: ${pcs23.length} (期待: 23)`);
console.log('PC一覧:', pcs23.join(', '));

// 飛び石になっていないか?
const expected = Array.from({ length: 23 }, (_, i) => `NO.${i + 1}`);
const missing = expected.filter((p) => !pcs23.includes(p));
const extra = pcs23.filter((p) => !expected.includes(p));
console.log('欠落PC:', missing.length ? missing.join(', ') : 'なし');
console.log('余計なPC:', extra.length ? extra.join(', ') : 'なし');

// NO.1 と NO.23 の値抽出
const no1 = rows23.find((r) => r.pc_number === 'NO.1' && r.stat_date === '2026-05-01');
const no23 = rows23.find((r) => r.pc_number === 'NO.23' && r.stat_date === '2026-05-07');
console.log('NO.1  / 2026-05-01:', no1);
console.log('NO.23 / 2026-05-07:', no23);
