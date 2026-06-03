/**
 * 47都道府県 / 8 地域マスタ。 prefecture と region (地方) の相互変換 + 住所抽出。
 *
 * 旧データの中には customers.prefecture に 「東北」 「関東」 等の地域名が
 * そのまま入っているケースがあり (CSV取込やシート同期由来)、 リスト抽出時に
 * フィルタが効かず混乱の原因になっていた。 このユーティリティで
 * 「地域名は県名ではない」 を正規化する。
 */

const PREFECTURES = [
  '北海道',
  '青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県',
  '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県',
  '徳島県','香川県','愛媛県','高知県',
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];

// 地域 → 含まれる都道府県
const REGIONS = {
  '北海道': ['北海道'],
  '東北':   ['青森県','岩手県','宮城県','秋田県','山形県','福島県'],
  '関東':   ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県'],
  '中部':   ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県'],
  '近畿':   ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'],
  '中国':   ['鳥取県','島根県','岡山県','広島県','山口県'],
  '四国':   ['徳島県','香川県','愛媛県','高知県'],
  '九州':   ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'],
};

// 「北海道」 は 都道府県 でも 地域 でもあるが、 ここでは 「都道府県以外の地域名」 のみを集約
//  → backfill 対象を判定するセット
const REGION_ONLY_NAMES = new Set(['東北','関東','中部','近畿','中国','四国','九州']);

const PREFECTURE_SET = new Set(PREFECTURES);

function isPrefecture(name) { return !!name && PREFECTURE_SET.has(name); }
function isRegionOnly(name) { return !!name && REGION_ONLY_NAMES.has(name); }

/**
 * 住所文字列から都道府県名を抽出
 *   "山形県米沢市東..." → "山形県"
 *   "北海道札幌市..."   → "北海道"
 *   "東北" などの地域名や住所無しなら null
 */
function extractPrefecture(address) {
  if (!address) return null;
  const s = String(address).trim();
  if (!s) return null;
  for (const pref of PREFECTURES) {
    if (s.startsWith(pref) || s.includes(pref)) return pref;
  }
  // 例外パターン (常用漢字外の異字体): 「XX都/道/府/県」 で始まり 6文字以下
  const m = s.match(/^([^\s\d]+?[都道府県])/);
  if (m && m[1].length <= 6 && !REGION_ONLY_NAMES.has(m[1])) return m[1];
  return null;
}

module.exports = {
  PREFECTURES,
  REGIONS,
  REGION_ONLY_NAMES,
  isPrefecture,
  isRegionOnly,
  extractPrefecture,
};
