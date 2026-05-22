/**
 * 詳細な業種名 → 6カテゴリへ正規化
 *   飲食   ... 飲食店、 食堂、 レストラン、 喫茶等
 *   製造   ... 〜製造業 全般
 *   小売   ... 〜小売業 全般
 *   宿泊   ... ホテル、 旅館、 民宿等
 *   建設   ... 工事業、 建設業、 建築業 (建築材料 卸売は除く)
 *   その他 ... 上記以外 (卸売、 運送、 介護、 サービス、 農業 等)
 *
 *   優先順位: 宿泊 > 飲食 > 建設 > 小売 > 製造 > その他
 *     (より specific なものを優先、 「小売」「製造」 は最後にチェック)
 */

const INDUSTRY_CATEGORIES = ['飲食', '製造', '小売', '宿泊', '建設', 'その他'];

function normalizeIndustry(raw) {
  if (raw === null || raw === undefined) return 'その他';
  const s = String(raw);
  if (!s.trim()) return 'その他';

  // 宿泊
  if (/宿泊|ホテル|旅館|民宿/.test(s)) return '宿泊';
  // 飲食店 (食堂・レストラン・喫茶) — 「飲食料品小売」 は別判定
  if (/飲食店|食堂|レストラン|喫茶|バー|居酒屋|カフェ/.test(s)) return '飲食';
  // 建設 (工事業 / 建設業 / 建築業 / 住まい・住宅・電気工事)
  //   ただし 建築材料卸売 や 建築事務所 は除外
  if (/工事業|建設業|建築業|住まい|住宅|電気工事/.test(s)) return '建設';
  // 小売
  if (/小売/.test(s)) return '小売';
  // 製造
  if (/製造/.test(s)) return '製造';
  return 'その他';
}

module.exports = {
  normalizeIndustry,
  INDUSTRY_CATEGORIES,
};
