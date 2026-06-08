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
  // 47都道府県 だけを厳密マッチ (= 配列のいずれかが文字列内にあれば採用)
  //   ※ 以前の 正規表現フォールバックは 「岐阜市水海道」 「大阪市都」 等を
  //     誤って prefecture として登録してしまうので 廃止。
  //     47都道府県 で見つからない住所は null = 「未確定」 とする
  for (const pref of PREFECTURES) {
    if (s.startsWith(pref) || s.includes(pref)) return pref;
  }
  return null;
}

/**
 * 渡された都道府県配列を解析して、 完全に揃っている地域 (8地域のうち) を抽出。
 * 戻り値: { full: [ '関東', ... ], remaining: [ '愛知県', ... ] }
 *   - full     : 配下都道府県が 完全に選択されている地域名
 *   - remaining: full にカバーされなかった単体の県名
 *
 * 用途: 顧客マスタフィルタで 「関東 7県 完全選択」 されたとき、 検索クエリに
 * 「関東」 という地域名 (バグ値や旧データに残ってる文字列) も含めて OR する。
 */
function expandRegions(prefList) {
  if (!Array.isArray(prefList) || !prefList.length) return { full: [], remaining: [] };
  const set = new Set(prefList);
  const full = [];
  const covered = new Set();
  for (const [region, prefs] of Object.entries(REGIONS)) {
    if (prefs.every((p) => set.has(p))) {
      full.push(region);
      prefs.forEach((p) => covered.add(p));
    }
  }
  const remaining = prefList.filter((p) => !covered.has(p));
  return { full, remaining };
}

/**
 * 選択された県名リストから 「該当する地域名」 を追加した拡張リストを返す。
 *   例: ['茨城県','大阪府']  → ['茨城県','大阪府','関東','近畿']
 *       ['北海道']           → ['北海道'] (北海道は地域=県名なので追加なし)
 *
 * 用途: callcenter.companies の prefecture 列に 「関東」 等の地域名が
 * そのまま残っているデータも、 県名選択でヒットさせる (クリーンアップ前
 * でも検索結果が出るように)
 */
function withRegionNames(prefList) {
  if (!Array.isArray(prefList) || !prefList.length) return [];
  const set = new Set(prefList);
  for (const [region, prefs] of Object.entries(REGIONS)) {
    if (region === '北海道') continue;  // 北海道は地域名=県名なので不要
    if (prefs.some((p) => set.has(p))) set.add(region);
  }
  return [...set];
}

module.exports = {
  PREFECTURES,
  REGIONS,
  REGION_ONLY_NAMES,
  isPrefecture,
  isRegionOnly,
  extractPrefecture,
  expandRegions,
  withRegionNames,
};
