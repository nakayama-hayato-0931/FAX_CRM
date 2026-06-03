/**
 * 電話番号 / FAX番号の正規化ユーティリティ。
 *
 * fax-crm.customers.phone_number は 国内フォーマット (例: 080-1234-5678 / 0312345678)
 * 一方 zp_recordings.caller_number は 国際フォーマット (例: +81 80 1234 5678 / +818012345678)
 * 直接比較すると 6,641 件中 1 件しかマッチしない問題があった。
 *
 * normalizePhone(raw)
 *   - 全角→半角 / ハイフン / カッコ / 空白 を除去
 *   - +81 / 0081 / 81 を 0 に置換 (日本国内番号として正規化)
 *   - 数字のみの文字列を返す。 normalize できないものは null
 *
 * 例:
 *   '+81 80-1234-5678'  → '08012345678'
 *   '+818012345678'     → '08012345678'
 *   '080-1234-5678'     → '08012345678'
 *   '(080) 1234 5678'   → '08012345678'
 *   '０８０-１２３４-５６７８' → '08012345678'  (全角)
 *   'anonymous'          → null
 *   ''                   → null
 */

// 全角数字 → 半角数字
function toHalfWidthDigits(s) {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (/anonymous/i.test(s)) return null;

  s = toHalfWidthDigits(s);
  // ハイフン / カッコ / スペース / ドット を削る
  s = s.replace(/[\s\-ー—‐()（）.]/g, '');
  // 先頭 + を 00 に変える前に、 +81 / 0081 / 81 を 0 に
  if (s.startsWith('+81')) s = '0' + s.slice(3);
  else if (s.startsWith('0081')) s = '0' + s.slice(4);
  else if (s.startsWith('81') && s.length >= 11 && s.length <= 13) {
    // 「81 80...」 のように頭 81 で始まり 全長 11-13 桁なら 国際表記の可能性が高い
    s = '0' + s.slice(2);
  } else if (s.startsWith('+')) {
    // 他国の番号は対象外
    return null;
  }
  // 残った非数字を除去 (本来このタイミングで残っているのは + 含む稀ケースのみ)
  s = s.replace(/[^0-9]/g, '');
  if (!s) return null;
  // 9 桁未満 / 全部 0 / 全部同じ数字 → placeholder 扱い
  if (s.length < 9) return null;
  if (/^0+$/.test(s)) return null;
  if (/^(\d)\1+$/.test(s)) return null;
  return s;
}

/**
 * digits-only 検索用 (LIKE / IN マッチ向け)
 *   normalizePhone と同じだが placeholder チェックを緩めて 「数字だけ抜き出し」 用
 */
function digitsOnly(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw);
  s = toHalfWidthDigits(s);
  if (s.startsWith('+81')) s = '0' + s.slice(3);
  else if (s.startsWith('0081')) s = '0' + s.slice(4);
  return s.replace(/[^0-9]/g, '');
}

module.exports = {
  normalizePhone,
  digitsOnly,
};
