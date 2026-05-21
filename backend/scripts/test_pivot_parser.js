#!/usr/bin/env node
/**
 * parsePivotSheet を実データ構造で検証する。
 * 構造前提(ユーザーの実シートに合わせる):
 *   ・先頭ブロック (NO.X マーカー出現前) は「全体合計」セクション → スキップ
 *   ・「NO.X」マーカー行で currentPc を確定
 *   ・以降の「送信件数」「エラー数」を currentPc に紐付け
 *   ・次の「NO.Y」マーカーで pcを切替
 */
const { parsePivotSheet, detectPivotFormat } = require('../src/services/faxStatsService');

// ---- ケース1: 実シート抜粋(全体合計セクション + NO.1 + NO.2)
const sample = [
  ['合計', '平均', '4/30', '5/1', '5/2', '5/3', '5/4', '5/5', '5/6', '5/7'],
  ['送信件数', '', '', '4548', '4802', '4396', '4728', '4907', '4266', '4775', '4497'],   // 全体合計→ skip
  ['エラー数', '', '', '998', '3814', '771', '749', '919', '952', '1715', '591'],         // 全体合計→ skip
  ['送信数合計', '', '', '18474', '6332', '', '', '', '28542', '5564'],                  // skip
  ['', '', '', '139120', '25403'],                                                        // skip (空ラベル行)
  ['NO.1', '', '', '', '504'],                                                            // ← NO.1 マーカー
  ['総数', '', '45756', '46062', '46370', '46678', '46999', '47308', '47605', '47891'],   // skip
  ['エラー総数', '', '5818', '5836', '5855', '5876', '5892', '5907', '5921', '5947'],     // skip
  ['送信件数', '273', '', '288', '289', '287', '305', '294', '283', '260', '266'],        // NO.1 のデータ
  ['エラー数', '', '', '18', '19', '21', '16', '15', '14', '26', '26'],                   // NO.1 のデータ
  ['NO.2', '', '', '', ''],                                                               // NO.2 マーカー
  ['送信件数', '', '', '100', '110', '120', '130', '140', '150', '160', '170'],           // NO.2 のデータ
  ['エラー数', '', '', '5', '6', '7', '8', '9', '10', '11', '12'],                        // NO.2 のデータ
];

console.log('=== ケース1: 実シート構造(全体合計 + NO.1 + NO.2) ===');
console.log('detectPivotFormat =', detectPivotFormat(sample));
const rows1 = parsePivotSheet(sample, { defaultYear: 2026 });
const pcs1 = [...new Set(rows1.map((r) => r.pc_number))];
console.log(`抽出行数: ${rows1.length} (期待: NO.1×7日 + NO.2×7日 = 14)`);
console.log('検出PC:', pcs1);
// NO.1 / 5/1 が 288 (4548 ではない!) になっていれば修正成功
const no1_5_1 = rows1.find((r) => r.pc_number === 'NO.1' && r.stat_date === '2026-05-01');
console.log('NO.1 / 5/1:', no1_5_1);
if (no1_5_1?.sent_count === 288) {
  console.log('✅ 全体合計セクションを正しくスキップ、NO.1=288件 が取得できた');
} else {
  console.log('❌ 全体合計が NO.1 に紛れ込んでいる可能性: sent=' + no1_5_1?.sent_count);
}

// ---- ケース2: NO.1〜NO.23 全部(全体合計+各PC)
console.log('\n=== ケース2: 全体合計セクション + NO.1〜NO.23 (23PC) ===');
const PC_COUNT = 23;
const DATES = ['5/1', '5/2', '5/3', '5/4', '5/5', '5/6', '5/7'];
const values23 = [['合計', '平均', ...DATES]];

// 全体合計セクション(スキップされる想定)
values23.push(['送信件数', '', ...Array(DATES.length).fill('99999')]);  // 異常値、スキップされるべき
values23.push(['エラー数',  '', ...Array(DATES.length).fill('88888')]);

for (let i = 1; i <= PC_COUNT; i++) {
  values23.push([`NO.${i}`, '', '', '', '']);  // マーカー先置
  values23.push(['総数', '', ...Array(DATES.length).fill('999999')]);          // skip
  values23.push(['エラー総数', '', ...Array(DATES.length).fill('111111')]);    // skip
  const sendRow = ['送信件数', ''];
  const errorRow = ['エラー数', ''];
  for (let d = 0; d < DATES.length; d++) {
    sendRow.push(String(300 + i * 10 + d));
    errorRow.push(String(10 + i + (d % 3)));
  }
  values23.push(sendRow);
  values23.push(errorRow);
}

console.log(`入力行数: ${values23.length}`);
const rows23 = parsePivotSheet(values23, { defaultYear: 2026 });
console.log(`抽出行数: ${rows23.length} (期待: 23PC × 7日 = 161)`);
const pcs23 = [...new Set(rows23.map((r) => r.pc_number))];
console.log(`検出PC数: ${pcs23.length} (期待: 23)`);
// 全体合計セクションの異常値 99999 が紛れ込んでいないか
const hasBadValue = rows23.some((r) => r.sent_count === 99999);
console.log(hasBadValue ? '❌ 全体合計セクション 99999 が紛れ込んでいる' : '✅ 全体合計は除外されている');
const no1Sample = rows23.find((r) => r.pc_number === 'NO.1' && r.stat_date === '2026-05-01');
console.log('NO.1 / 5/1:', no1Sample);  // 310 のはず (300 + 1*10 + 0)
const no23Sample = rows23.find((r) => r.pc_number === 'NO.23' && r.stat_date === '2026-05-07');
console.log('NO.23 / 5/7:', no23Sample); // 536 のはず (300 + 23*10 + 6)
