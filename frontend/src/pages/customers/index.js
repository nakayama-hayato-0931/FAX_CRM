import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import CustomerCsvImportModal from '@/components/CustomerCsvImportModal';
import CustomerDetailModal from '@/components/CustomerDetailModal';

// 8地域 → 構成都道府県 (lists/new.js と同じ定義)
const REGION_GROUPS = [
  { region: '北海道', prefs: ['北海道'] },
  { region: '東北',   prefs: ['青森県','岩手県','宮城県','秋田県','山形県','福島県'] },
  { region: '関東',   prefs: ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県'] },
  { region: '中部',   prefs: ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県'] },
  { region: '近畿',   prefs: ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'] },
  { region: '中国',   prefs: ['鳥取県','島根県','岡山県','広島県','山口県'] },
  { region: '四国',   prefs: ['徳島県','香川県','愛媛県','高知県'] },
  { region: '九州',   prefs: ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'] },
];

const DEMO_CUSTOMERS = [
  { id: 1, company_name: '株式会社サンプル製作所', fax_number: '0312345678', industry: '製造業', prefecture: '東京都', city: '千代田区', send_count: 4, last_sent_at: '2026-04-22T10:00:00Z', last_pc_number: 'PC03', last_result: 'no_response', response_count: 0, is_blacklisted: 0, updated_at: '2026-04-22T10:00:00Z' },
  { id: 2, company_name: '合同会社テスト商事', fax_number: '0623456789', industry: '卸売業', prefecture: '大阪府', city: '大阪市北区', send_count: 6, last_sent_at: '2026-03-15T09:00:00Z', last_pc_number: 'PC01', last_result: 'response_inquiry', response_count: 1, is_blacklisted: 0, updated_at: '2026-03-15T09:00:00Z' },
  { id: 3, company_name: 'ABC技研株式会社', fax_number: '0523456789', industry: '情報通信', prefecture: '愛知県', city: '名古屋市中区', send_count: 2, last_sent_at: '2026-02-28T11:00:00Z', last_pc_number: 'PC02', last_result: 'response_order', response_count: 1, is_blacklisted: 0, updated_at: '2026-02-28T11:00:00Z' },
  { id: 4, company_name: '有限会社デモ建設', fax_number: '0114567890', industry: '建設業', prefecture: '北海道', city: '札幌市中央区', send_count: 8, last_sent_at: '2026-04-10T14:00:00Z', last_pc_number: 'PC05', last_result: 'refusal', response_count: 0, is_blacklisted: 1, updated_at: '2026-04-10T14:00:00Z' },
  { id: 5, company_name: '株式会社モック食品', fax_number: '0925678901', industry: '食料品製造', prefecture: '福岡県', city: '福岡市博多区', send_count: 0, last_sent_at: null, last_pc_number: null, last_result: null, response_count: 0, is_blacklisted: 0, updated_at: '2026-05-01T08:00:00Z' },
];

const RESULT_LABEL = {
  no_response: '受電なし',
  response_inquiry: '問合せ',
  response_order: '発注',
  refusal: '拒否',
  invalid_number: '番号無効',
  other: 'その他',
};

export default function CustomersPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', industry: '', prefectures: [], blacklisted: '', has_fax: '', minCallCount: '', minExtractCount: '' });
  const [showPrefPanel, setShowPrefPanel] = useState(false);
  const [industries, setIndustries] = useState([]);
  const [prefectures, setPrefectures] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [showImport, setShowImport] = useState(false);
  // 詳細モーダル: { id, initialTab, channelFilter }
  const [detail, setDetail] = useState(null);
  const [syncPulling, setSyncPulling] = useState(false);
  const [syncPushing, setSyncPushing] = useState(false);
  const [syncingBoth, setSyncingBoth] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [recategorizing, setRecategorizing] = useState(false);
  const [normalizingPref, setNormalizingPref] = useState(false);
  const [normalizingPhoneFax, setNormalizingPhoneFax] = useState(false);

  const normalizePhoneFax = async () => {
    if (isDemo) { toast('デモ表示中は実行できません'); return; }
    if (!window.confirm('全顧客の phone_number / fax_number から ハイフン (-) / 全角ダッシュ (ー) / 空白 / カッコ等を一括除去し 数字のみに揃えます。 進めますか？')) return;
    setNormalizingPhoneFax(true);
    try {
      const { data } = await api.post('/api/customers/normalize-phone-fax', null, { timeout: 30 * 60 * 1000 });
      const r = data.data || {};
      const lines = [
        `fax-crm: phone=${r.faxCrm?.phone ?? 0} / fax=${r.faxCrm?.fax ?? 0}`,
        `callcenter: phone=${r.callcenter?.phone ?? 0} / fax=${r.callcenter?.fax ?? 0}`,
      ];
      toast.success(`電話/FAX 正規化完了\n${lines.join('\n')}`, { duration: 10000 });
      reload();
    } catch (e) {
      toast.error(e.userMessage || '正規化失敗');
    } finally {
      setNormalizingPhoneFax(false);
    }
  };

  const normalizePref = async (mode) => {
    if (isDemo) { toast('デモ表示中は実行できません', { icon: 'ℹ' }); return; }
    const label = {
      invalid: '47都道府県 以外の値 (地域名 / 住所断片の誤抽出 等) の行を address から県名に再抽出します。 抽出できなかった行は NULL に戻します。 進めますか？',
      region:  '都道府県 が 地域名 (東北/関東/...) の行を address から県名に再抽出します。 進めますか？',
      missing: '都道府県 が 未設定 の行を address から県名抽出します。 進めますか？',
      all:     '全顧客 を address から県名 再抽出します (現値も上書き)。 進めますか？',
    }[mode];
    if (!window.confirm(label)) return;
    setNormalizingPref(true);
    try {
      const { data } = await api.post(`/api/customers/normalize-prefecture?mode=${mode}`, null, {
        timeout: 30 * 60 * 1000,
      });
      const r = data.data || {};
      const lines = [];
      const fmt = (label, x) => {
        if (!x) return null;
        if (x.skipped) return `${label}: スキップ (${x.skipped})`;
        const top = Object.entries(x.byPrefecture || {})
          .sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([k, v]) => `${k}:${v}`).join('/') || '変更なし';
        return `${label}: 走査${x.scanned ?? 0} / 更新${x.updated ?? 0} (${top})`;
      };
      const fxLine = fmt('fax-crm', r.faxcrm);
      const ccLine = fmt('callcenter', r.callcenter);
      if (fxLine) lines.push(fxLine);
      if (ccLine) lines.push(ccLine);
      toast.success(`都道府県 正規化完了\n${lines.join('\n')}`, { duration: 12000 });
      reload();
    } catch (e) {
      toast.error(e.userMessage || '正規化失敗');
    } finally {
      setNormalizingPref(false);
    }
  };

  const reload = () => setReloadKey((k) => k + 1);

  const recategorize = async (mode) => {
    if (isDemo) { toast('デモ表示中は再分類できません'); return; }
    const label = mode === 'all'
      ? '全顧客の業種カテゴリ を industry/備考 から再算出して上書きします (既存の明示分類も上書き)。 進めますか？'
      : '業種カテゴリ が 未分類 / その他 の顧客を再算出します。 既に明示分類済みの行は触りません。 進めますか？';
    if (!window.confirm(label)) return;
    setRecategorizing(true);
    try {
      const { data } = await api.post(`/api/customers/recategorize?mode=${mode}`, null, {
        timeout: 30 * 60 * 1000,
      });
      const r = data.data || {};
      const lines = [];
      const fmt = (label, x) => {
        if (!x) return null;
        if (x.skipped) return `${label}: スキップ (${x.skipped})`;
        const top = Object.entries(x.byCategory || {})
          .sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([k, v]) => `${k}:${v}`).join('/') || '変更なし';
        return `${label}: 走査${x.scanned ?? 0} / 更新${x.updated ?? 0} (${top})`;
      };
      const fx = fmt('fax-crm', r.faxcrm);
      const cc = fmt('callcenter', r.callcenter);
      if (fx) lines.push(fx);
      if (cc) lines.push(cc);
      toast.success(`業種カテゴリ 再分類完了\n${lines.join('\n')}`, { duration: 12000 });
      reload();
    } catch (e) {
      toast.error(e.userMessage || '再分類失敗');
    } finally {
      setRecategorizing(false);
    }
  };

  useEffect(() => {
    if (isDemo) return;
    api.get('/api/customers/sync/status')
      .then((r) => setSyncStatus(r.data?.data || null))
      .catch(() => {});
  }, [isDemo]);

  const pullFromCallcenter = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    if (!syncStatus?.configured) {
      toast.error('callcenter 連携が未設定 (環境変数 CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN を設定してください)');
      return;
    }
    setSyncPulling(true);
    try {
      const { data } = await api.post('/api/customers/sync/pull', null, { timeout: 30 * 60 * 1000 });
      const r = data.data || {};
      const modeLabel = r.mode === 'incremental' ? `差分 (since ${r.updated_since?.slice(0, 19) || '?'})` : '全件';
      toast.success(`callcenter → fax-crm [${modeLabel}]: 取得${r.fetched ?? 0}件 / upsert${r.upserted ?? 0}件 (${r.elapsedSec ?? '?'}s)`, { duration: 8000 });
      reload();
    } catch (e) {
      toast.error(e.userMessage || 'callcenter からの取り込み失敗');
    } finally { setSyncPulling(false); }
  };

  const pullFullFromCallcenter = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    if (!syncStatus?.configured) { toast.error('callcenter 連携が未設定'); return; }
    if (!window.confirm('差分フィルタを無視して callcenter から全件 pull します。 200万件規模だと数十分かかる可能性があります。 進めますか？')) return;
    setSyncPulling(true);
    try {
      const { data } = await api.post('/api/customers/sync/pull?full=1', null, { timeout: 60 * 60 * 1000 });
      const r = data.data || {};
      toast.success(`全件同期OK: 取得${r.fetched ?? 0}件 / upsert${r.upserted ?? 0}件 (${r.elapsedSec ?? '?'}s)`, { duration: 10000 });
      reload();
    } catch (e) {
      toast.error(e.userMessage || '全件同期失敗');
    } finally { setSyncPulling(false); }
  };

  const syncBoth = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    if (!syncStatus?.configured) {
      toast.error('callcenter 連携が未設定 (環境変数 CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN を設定してください)');
      return;
    }
    setSyncingBoth(true);
    try {
      // 200万件規模の可能性があるため timeout を 30分まで延長
      const { data } = await api.post('/api/customers/sync/both?limit=2000', null, { timeout: 30 * 60 * 1000 });
      const r = data.data || {};
      const pull = r.pull || {};
      const push = r.push || {};
      const modeLabel = pull.mode === 'incremental' ? `差分 since ${pull.updated_since?.slice(0, 19) || '?'}` : '全件';
      toast.success(
        `双方向同期OK\n` +
        `← 取込 [${modeLabel}]: ${pull.fetched ?? 0}件 (upsert ${pull.upserted ?? 0} / skip ${pull.skipped ?? 0}、 ${pull.elapsedSec ?? '?'}s)\n` +
        `→ 送信: ${push.total ?? 0}件中 新規${push.created ?? 0} / 更新${push.updated ?? 0} / エラー${push.errors ?? 0}`,
        { duration: 10000 }
      );
      if (r.error) toast.error(r.error, { duration: 10000 });
      reload();
    } catch (e) {
      toast.error(e.userMessage || '双方向同期失敗');
    } finally { setSyncingBoth(false); }
  };

  const pushToCallcenter = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    if (!syncStatus?.configured) {
      toast.error('callcenter 連携が未設定');
      return;
    }
    if (!window.confirm('fax-crm の顧客マスタを callcenter へ送信します。 既存の external_callcenter_id がある顧客は更新、 ない顧客は新規作成されます。 進めますか？')) return;
    setSyncPushing(true);
    try {
      const { data } = await api.post('/api/customers/sync/push?limit=2000');
      const r = data.data || {};
      toast.success(`fax-crm→callcenter: 対象${r.total ?? 0} / 新規${r.created ?? 0} / 更新${r.updated ?? 0} / スキップ${r.skipped ?? 0} / エラー${r.errors ?? 0}`);
      reload();
    } catch (e) {
      toast.error(e.userMessage || 'callcenter への送信失敗');
    } finally { setSyncPushing(false); }
  };

  // Phase 3a: ドリフトチェック
  const driftCheck = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    setSyncPushing(true);
    const t = toast.loading('ドリフトチェック中...');
    try {
      const { data } = await api.get('/api/customers/sync/drift-check?sample=200');
      toast.dismiss(t);
      const r = data.data || {};
      const statusEmoji = r.status === 'healthy' ? '✓' : r.status === 'minor_drift' ? '!' : '✗';
      toast.success(
        `${statusEmoji} ${r.status}\n` +
        `fax-crm: 全${r.fax_crm?.total ?? '-'} / 紐${r.fax_crm?.linked ?? '-'} / 未紐${r.fax_crm?.unlinked ?? '-'}\n` +
        `callcenter: 全${r.callcenter?.total ?? '-'} / 紐${r.callcenter?.linked ?? '-'} / ext${r.callcenter?.fax_ext_rows ?? '-'}\n` +
        `サンプル整合: ${r.drift?.sample_consistent ?? '-'}/${r.drift?.sample_size ?? '-'} (${r.drift?.sample_consistency_rate ?? '-'}%)`,
        { duration: 30000 }
      );
      // eslint-disable-next-line no-console
      console.log('[drift-check]', r);
    } catch (e) {
      toast.dismiss(t);
      toast.error(e.userMessage || 'ドリフトチェック失敗');
    } finally { setSyncPushing(false); }
  };

  // Phase 2: 差分バックフィル (external_callcenter_id IS NULL の取りこぼしのみ)
  const diffBackfill = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    if (!window.confirm('callcenter に未連携の顧客のみを差分バックフィルします。\n（シャドー書きの取りこぼし回収）\nよろしいですか？')) return;
    setSyncPushing(true);
    const t = toast.loading('差分バックフィル中...');
    try {
      const { data } = await api.post('/api/customers/sync/diff-backfill', null, { timeout: 60 * 60 * 1000 });
      toast.dismiss(t);
      const r = data.data || {};
      toast.success(
        `差分バックフィル 完了\n対象 ${r.total ?? 0} / 書込 ${r.processed ?? 0} / エラー ${r.errors ?? 0}` +
        (r.elapsedSec ? ` (${r.elapsedSec}s)` : ''),
        { duration: 15000 }
      );
    } catch (e) {
      toast.dismiss(t);
      toast.error(e.userMessage || '差分バックフィル失敗');
    } finally { setSyncPushing(false); }
  };

  // Phase 2: callcenter DB に直接シャドーバックフィル
  const shadowBackfill = async (testOnly) => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    const limit = testOnly ? 10 : 0;
    const label = testOnly ? '10件だけ試験書き込み' : '全件 callcenter DB に直接書き込み';
    if (!window.confirm(`${label}を実行します。callcenter DB へ直接 INSERT/UPDATE します。\nよろしいですか？`)) return;
    setSyncPushing(true);
    const t = toast.loading(testOnly ? 'テスト書き込み中...' : '全件シャドーバックフィル中...');
    try {
      // まず status 確認
      const sres = await api.get('/api/customers/sync/shadow-status');
      const s = sres.data.data || {};
      if (!s.configured) {
        toast.dismiss(t);
        toast.error('CALLCENTER_DB_URL が未設定です。fax-crm backend の環境変数を確認してください');
        return;
      }
      if (!s.ok) {
        toast.dismiss(t);
        toast.error(`callcenter DB に接続できません: ${s.error || 'unknown'}`);
        return;
      }
      // バックフィル実行
      const { data } = await api.post(`/api/customers/sync/shadow-backfill?limit=${limit}`, null, { timeout: 24 * 60 * 60 * 1000 });
      toast.dismiss(t);
      const r = data.data || {};
      toast.success(
        `シャドーバックフィル 完了\n` +
        `対象 ${r.total ?? 0} / 書込 ${r.processed ?? 0} / 電話無しスキップ ${r.skipped_no_phone ?? 0} / エラー ${r.errors ?? 0}` +
        (r.elapsedSec ? ` (${r.elapsedSec}s)` : ''),
        { duration: 15000 }
      );
    } catch (e) {
      toast.dismiss(t);
      toast.error(e.userMessage || 'シャドーバックフィル失敗');
    } finally { setSyncPushing(false); }
  };

  // 未連携のみ全件 push (external_callcenter_id IS NULL の顧客を全件 callcenter に作成)
  const pushUnlinkedToCallcenter = async () => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    if (!syncStatus?.configured) { toast.error('callcenter 連携が未設定'); return; }
    if (!window.confirm('callcenter に未連携の顧客のみを全件 callcenter に作成します。\n件数が多い場合は数十分〜数時間かかります。\n進めますか？')) return;
    setSyncPushing(true);
    const t = toast.loading('未連携顧客を全件 push 中...');
    try {
      // limit=0 = 上限なし
      const { data } = await api.post('/api/customers/sync/push?limit=0&unlinked_only=1', null, { timeout: 24 * 60 * 60 * 1000 });
      toast.dismiss(t);
      const r = data.data || {};
      toast.success(`未連携 push 完了: 対象${r.total ?? 0} / 新規${r.created ?? 0} / 更新${r.updated ?? 0} / スキップ${r.skipped ?? 0} / エラー${r.errors ?? 0} (${r.batches}バッチ)`, { duration: 15000 });
      reload();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e.userMessage || '未連携 push 失敗');
    } finally { setSyncPushing(false); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setItems(DEMO_CUSTOMERS);
        setPagination({ page: 1, pageSize: 50, total: DEMO_CUSTOMERS.length, totalPages: 1 });
        setIndustries([
          { industry: '製造業', cnt: 1 },
          { industry: '卸売業', cnt: 1 },
          { industry: '情報通信', cnt: 1 },
          { industry: '建設業', cnt: 1 },
          { industry: '食料品製造', cnt: 1 },
        ]);
        setPrefectures([
          { prefecture: '東京都', cnt: 1 },
          { prefecture: '大阪府', cnt: 1 },
          { prefecture: '愛知県', cnt: 1 },
          { prefecture: '北海道', cnt: 1 },
          { prefecture: '福岡県', cnt: 1 },
        ]);
        return;
      }
      setLoading(true);
      try {
        const params = { page, pageSize: 50 };
        if (filters.q) params.q = filters.q;
        if (filters.industry) params.industry = filters.industry;
        if (filters.prefectures?.length) params.prefecture = filters.prefectures.join(',');
        if (filters.blacklisted !== '') params.blacklisted = filters.blacklisted;
        if (filters.has_fax !== '') params.has_fax = filters.has_fax;
        if (filters.minCallCount && Number(filters.minCallCount) > 0) params.minCallCount = Number(filters.minCallCount);
        if (filters.minExtractCount && Number(filters.minExtractCount) > 0) params.minExtractCount = Number(filters.minExtractCount);
        const [list, ind, pref] = await Promise.all([
          api.get('/api/customers', { params }),
          api.get('/api/customers/facets/industries'),
          api.get('/api/customers/facets/prefectures'),
        ]);
        if (cancelled) return;
        setItems(list.data.data || []);
        setPagination(list.data.meta?.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 });
        setIndustries(ind.data.data || []);
        setPrefectures(pref.data.data || []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.userMessage || '読み込み失敗');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey, page, filters.industry, JSON.stringify(filters.prefectures), filters.blacklisted, filters.has_fax, filters.minCallCount, filters.minExtractCount]);

  // フィルタ変更時に page=1 にリセット (検索 q 以外、 q は Enter で発火するので別ハンドリング)
  useEffect(() => {
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.industry, JSON.stringify(filters.prefectures), filters.blacklisted, filters.has_fax, filters.minCallCount, filters.minExtractCount]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">顧客マスタ</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            {pagination.total.toLocaleString()} 件
            {syncStatus?.last_synced_at && (
              <span className="ml-2 text-xs text-zinc-400">
                callcenter最終同期: {new Date(syncStatus.last_synced_at).toLocaleString('ja-JP')}
              </span>
            )}
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={reload} className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            再読み込み
          </button>

          {/* ▼ 同期 (callcenter 連携 + 個別操作 すべて畳む) */}
          <details className="inline-block">
            <summary className="cursor-pointer px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 list-none select-none">
              ▼ 同期
            </summary>
            <div className="absolute mt-1 bg-white border border-zinc-200 rounded-md shadow-lg p-2 flex flex-col gap-1 z-10 min-w-[220px]">
              {/* primary: 双方向同期 */}
              <button
                onClick={syncBoth}
                disabled={syncingBoth || syncPulling || syncPushing || (syncStatus && !syncStatus.configured)}
                className="px-3 py-1.5 text-xs bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 whitespace-nowrap"
                title={syncStatus?.configured
                  ? 'callcenter と双方向同期 (pull → push 順次)'
                  : 'callcenter 連携 未設定 (env: CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN)'}
              >
                {syncingBoth ? '双方向同期中…' : 'callcenter と双方向同期'}
              </button>
              <hr className="border-zinc-200 my-1" />
              {/* Phase 2 (推奨) */}
              <button
                onClick={() => shadowBackfill(true)}
                disabled={syncPushing || syncingBoth}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
                title="Phase 2: 10件だけ callcenter DB に直接書き込んでみる"
              >
                {syncPushing ? '実行中…' : 'Phase2 テスト書込 (10件)'}
              </button>
              <button
                onClick={() => shadowBackfill(false)}
                disabled={syncPushing || syncingBoth}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-300 text-emerald-800 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
                title="Phase 2: 全件 callcenter DB に直接書き込み (時間かかります)"
              >
                {syncPushing ? '実行中…' : 'Phase2 全件バックフィル'}
              </button>
              <button
                onClick={diffBackfill}
                disabled={syncPushing || syncingBoth}
                className="px-3 py-1.5 text-xs bg-white border border-teal-200 text-teal-700 rounded hover:bg-teal-50 disabled:opacity-50 whitespace-nowrap"
                title="未連携 (external_callcenter_id IS NULL) の取りこぼしのみ"
              >
                {syncPushing ? '実行中…' : 'Phase2 差分バックフィル'}
              </button>
              <button
                onClick={driftCheck}
                disabled={syncPushing || syncingBoth}
                className="px-3 py-1.5 text-xs bg-white border border-sky-200 text-sky-700 rounded hover:bg-sky-50 disabled:opacity-50 whitespace-nowrap"
                title="2DB のドリフト (整合性) を比較"
              >
                {syncPushing ? '実行中…' : 'Phase3 ドリフトチェック'}
              </button>
              <hr className="border-zinc-200 my-1" />
              {/* 全件再同期 */}
              <button
                onClick={pullFullFromCallcenter}
                disabled={syncPulling || syncingBoth || (syncStatus && !syncStatus.configured)}
                className="px-3 py-1.5 text-xs bg-white border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap"
                title="差分フィルタを無視して callcenter から全件 pull (時間かかります)"
              >
                {syncPulling ? '全件同期中…' : '⟳ 全件再同期 (差分無視)'}
              </button>
              <hr className="border-zinc-200 my-1" />
              {/* レガシー (取消線) */}
              <button
                onClick={pullFromCallcenter}
                disabled={syncPulling || syncingBoth || (syncStatus && !syncStatus.configured)}
                className="px-3 py-1.5 text-xs bg-white border border-zinc-200 text-zinc-400 rounded hover:bg-sky-50 disabled:opacity-50 whitespace-nowrap line-through"
                title="(レガシー) HTTPベース取込。Phase 2 のシャドー書き込みで実質不要"
              >
                {syncPulling ? '取込中…' : '← 取込のみ (旧)'}
              </button>
              <button
                onClick={pushToCallcenter}
                disabled={syncPushing || syncingBoth || (syncStatus && !syncStatus.configured)}
                className="px-3 py-1.5 text-xs bg-white border border-zinc-200 text-zinc-400 rounded hover:bg-sky-50 disabled:opacity-50 whitespace-nowrap line-through"
                title="(レガシー) HTTPベース送信。Phase 2 のシャドー書き込みで実質不要"
              >
                {syncPushing ? '送信中…' : '→ 送信のみ (旧)'}
              </button>
              <button
                onClick={pushUnlinkedToCallcenter}
                disabled={syncPushing || syncingBoth || (syncStatus && !syncStatus.configured)}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-200 text-emerald-500 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap line-through"
                title="(レガシー) HTTPベース未連携 push。Phase 2 の差分バックフィルを推奨"
              >
                {syncPushing ? '送信中…' : '+ 未連携のみ push (旧)'}
              </button>
            </div>
          </details>

          {/* ▼ メンテナンス (業種カテゴリ + 都道府県 を統合) */}
          <details className="inline-block">
            <summary className="cursor-pointer px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50 list-none select-none">
              ▼ メンテナンス
            </summary>
            <div className="absolute mt-1 bg-white border border-zinc-200 rounded-md shadow-lg p-2 flex flex-col gap-1 z-10 min-w-[220px]">
              <div className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">業種カテゴリ</div>
              <button
                onClick={() => recategorize('missing')}
                disabled={recategorizing}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
                title="未分類 / その他 の行のみ再算出 (既存の明示分類は尊重)"
              >
                {recategorizing ? '実行中…' : '未分類のみ 再分類'}
              </button>
              <button
                onClick={() => recategorize('all')}
                disabled={recategorizing}
                className="px-3 py-1.5 text-xs bg-white border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap"
                title="全顧客を industry/備考 から再算出して強制上書き"
              >
                {recategorizing ? '実行中…' : '全件 強制再分類'}
              </button>
              <hr className="border-zinc-200 my-1" />
              <div className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">都道府県</div>
              <button
                onClick={() => normalizePref('invalid')}
                disabled={normalizingPref}
                className="px-3 py-1.5 text-xs bg-white border border-rose-200 text-rose-700 rounded hover:bg-rose-50 disabled:opacity-50 whitespace-nowrap"
                title="47都道府県以外の値 (地域名/住所断片の誤抽出 等) を address から県名に再抽出。 抽出できなかった行は NULL に戻す"
              >
                {normalizingPref ? '実行中…' : '無効値クリーンアップ (推奨)'}
              </button>
              <button
                onClick={() => normalizePref('region')}
                disabled={normalizingPref}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
                title="地域名 (東北/関東/中部/...) の行を address から県名に再抽出"
              >
                {normalizingPref ? '実行中…' : '地域名 → 県名 に正規化'}
              </button>
              <button
                onClick={() => normalizePref('missing')}
                disabled={normalizingPref}
                className="px-3 py-1.5 text-xs bg-white border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap"
                title="prefecture が NULL / 空 の行を address から県名抽出"
              >
                {normalizingPref ? '実行中…' : '未設定のみ バックフィル'}
              </button>
              <button
                onClick={() => normalizePref('all')}
                disabled={normalizingPref}
                className="px-3 py-1.5 text-xs bg-white border border-amber-200 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap"
                title="全顧客を address から県名再抽出 (現値も上書き)"
              >
                {normalizingPref ? '実行中…' : '全件 強制再抽出'}
              </button>

              <hr className="border-zinc-200 my-1" />
              <div className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">電話 / FAX</div>
              <button
                onClick={normalizePhoneFax}
                disabled={normalizingPhoneFax}
                className="px-3 py-1.5 text-xs bg-white border border-emerald-200 text-emerald-700 rounded hover:bg-emerald-50 disabled:opacity-50 whitespace-nowrap"
                title="既に保存されている phone_number / fax_number から ハイフン (-) / 全角ダッシュ (ー) / 空白 / カッコ等を一括除去して 数字のみに揃える"
              >
                {normalizingPhoneFax ? '実行中…' : 'ハイフン等の一括除去'}
              </button>
            </div>
          </details>

          <button onClick={() => setShowImport(true)}
                  className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700">
            リストインポート
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            className="border border-zinc-300 rounded-md px-3 py-2 text-sm md:col-span-2"
            placeholder="会社名・FAX番号で検索 (Enterで検索)"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && reload()}
          />
          <select className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                  value={filters.industry}
                  onChange={(e) => setFilters({ ...filters, industry: e.target.value })}>
            <option value="">業種 (すべて)</option>
            {industries.map((i) => (
              <option key={i.industry} value={i.industry}>{i.industry} ({i.cnt})</option>
            ))}
          </select>
          {/* 都道府県 multi-select (47県固定リスト、 地域グループ + チェックボックス) */}
          <div className="relative">
            <button type="button"
                    onClick={() => setShowPrefPanel((v) => !v)}
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm text-left bg-white hover:bg-zinc-50 flex items-center justify-between">
              <span>
                {filters.prefectures.length === 0
                  ? '都道府県 (すべて)'
                  : filters.prefectures.length <= 2
                    ? filters.prefectures.join(', ')
                    : `${filters.prefectures.length} 県選択中`}
              </span>
              <span className="text-zinc-400 ml-2">▾</span>
            </button>
            {showPrefPanel && (
              <>
                {/* 外側クリックで閉じる */}
                <div className="fixed inset-0 z-10" onClick={() => setShowPrefPanel(false)} />
                <div className="absolute z-20 mt-1 w-[420px] right-0 bg-white border border-zinc-200 rounded-md shadow-lg p-3 max-h-[60vh] overflow-auto">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-zinc-700">
                      都道府県 ({filters.prefectures.length === 0 ? 'すべて' : `${filters.prefectures.length} 県`})
                    </span>
                    <button type="button"
                            onClick={() => setFilters({ ...filters, prefectures: [] })}
                            disabled={filters.prefectures.length === 0}
                            className="text-[11px] text-zinc-500 hover:underline disabled:invisible">
                      全クリア
                    </button>
                  </div>
                  <div className="text-[11px] text-zinc-500 mb-2">
                    地域名クリック で 配下全選択/解除。 県名チェックで個別選択。
                  </div>
                  <div className="space-y-1.5">
                    {REGION_GROUPS.map((g) => {
                      const allSel = g.prefs.every((p) => filters.prefectures.includes(p));
                      const someSel = g.prefs.some((p) => filters.prefectures.includes(p));
                      return (
                        <div key={g.region} className="flex items-start gap-1.5">
                          <button type="button"
                                  onClick={() => {
                                    const set = new Set(filters.prefectures);
                                    if (allSel) g.prefs.forEach((p) => set.delete(p));
                                    else g.prefs.forEach((p) => set.add(p));
                                    setFilters({ ...filters, prefectures: [...set] });
                                  }}
                                  className={[
                                    'flex-shrink-0 text-[10px] w-12 py-0.5 rounded font-medium transition',
                                    allSel
                                      ? 'bg-emerald-600 text-white'
                                      : someSel
                                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                                        : 'bg-white text-zinc-500 border border-zinc-300 hover:bg-zinc-50',
                                  ].join(' ')}>
                            {g.region}
                          </button>
                          <div className="flex flex-wrap gap-0.5">
                            {g.prefs.map((p) => {
                              const checked = filters.prefectures.includes(p);
                              return (
                                <label key={p}
                                       className={[
                                         'cursor-pointer text-[11px] px-1.5 py-0.5 rounded border transition select-none',
                                         checked
                                           ? 'bg-emerald-600 text-white border-emerald-600'
                                           : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50',
                                       ].join(' ')}>
                                  <input type="checkbox" checked={checked}
                                         onChange={() => {
                                           const set = new Set(filters.prefectures);
                                           if (checked) set.delete(p); else set.add(p);
                                           setFilters({ ...filters, prefectures: [...set] });
                                         }}
                                         className="sr-only" />
                                  {p}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
          <select className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                  value={filters.blacklisted}
                  onChange={(e) => setFilters({ ...filters, blacklisted: e.target.value })}>
            <option value="">B/L: すべて</option>
            <option value="false">通常のみ</option>
            <option value="true">ブラックリストのみ</option>
          </select>
          <select className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                  value={filters.has_fax}
                  onChange={(e) => setFilters({ ...filters, has_fax: e.target.value })}>
            <option value="">FAX: すべて</option>
            <option value="true">FAX番号あり</option>
            <option value="false">FAX番号なし</option>
          </select>
          <div className="flex items-center gap-1 border border-zinc-300 rounded-md px-2 py-1 bg-white"
               title="架電回数 (contact_events channel=call) が N 回以上の顧客に絞る">
            <span className="text-xs text-zinc-500 whitespace-nowrap">架電</span>
            <input type="number" min="0" max="999" placeholder="0"
                   value={filters.minCallCount}
                   onChange={(e) => setFilters({ ...filters, minCallCount: e.target.value })}
                   className="w-12 text-sm border-0 outline-none tabular-nums text-right" />
            <span className="text-xs text-zinc-500 whitespace-nowrap">回〜</span>
          </div>
          <div className="flex items-center gap-1 border border-zinc-300 rounded-md px-2 py-1 bg-white"
               title="抽出履歴 (extract_count) が N 回以上の顧客に絞る">
            <span className="text-xs text-zinc-500 whitespace-nowrap">抽出</span>
            <input type="number" min="0" max="999" placeholder="0"
                   value={filters.minExtractCount}
                   onChange={(e) => setFilters({ ...filters, minExtractCount: e.target.value })}
                   className="w-12 text-sm border-0 outline-none tabular-nums text-right" />
            <span className="text-xs text-zinc-500 whitespace-nowrap">回〜</span>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                  onClick={reload}>検索</button>
          <button className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded-md"
                  onClick={() => {
                    setFilters({ q: '', industry: '', prefectures: [], blacklisted: '', has_fax: '', minCallCount: '', minExtractCount: '' });
                    setTimeout(reload, 0);
                  }}>条件クリア</button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">会社名</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">FAX</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">電話</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider" title="詳細業種にマウスホバーで表示">業種</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">都道府県</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">架電</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">送信回数</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">最終送信</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">直近結果</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">状態</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-zinc-400">読み込み中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-zinc-400">
                  顧客データがありません。「CSVインポート」から取り込んでください。
                </td></tr>
              )}
              {!loading && items.map((c) => (
                <tr key={c.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setDetail({ id: c.id, initialTab: 'overview' })}
                      className="text-emerald-700 hover:underline font-medium text-left"
                    >
                      {c.company_name}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-700">{c.fax_number || <span className="text-zinc-300">—</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-700">{c.phone_number || <span className="text-zinc-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-zinc-700" title={c.industry || ''}>
                    {c.industry_category || c.industry || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-700">{c.prefecture || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {Number(c.call_count) > 0 ? (
                      <button
                        type="button"
                        onClick={() => setDetail({ id: c.id, initialTab: 'calls', channelFilter: 'call' })}
                        className="text-emerald-600 hover:text-emerald-800 underline underline-offset-2 font-medium"
                        title="架電結果の詳細を表示"
                      >
                        {c.call_count}
                      </button>
                    ) : (
                      <span className="text-zinc-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.send_count}</td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">
                    {c.last_sent_at ? new Date(c.last_sent_at).toLocaleDateString('ja-JP') : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.last_result ? RESULT_LABEL[c.last_result] || c.last_result : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.is_blacklisted
                      ? <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">B/L</span>
                      : <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700">通常</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-zinc-200 text-sm flex-wrap">
            <div className="text-zinc-500">
              ページ <span className="font-medium text-zinc-700">{pagination.page}</span> / {pagination.totalPages.toLocaleString()}
              <span className="ml-3 text-xs text-zinc-400">({pagination.total.toLocaleString()} 件)</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={pagination.page <= 1 || loading}
                className="px-2.5 py-1 text-xs border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="最初のページ"
              >
                « 最初
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1 || loading}
                className="px-2.5 py-1 text-xs border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ‹ 前へ
              </button>
              <div className="flex items-center gap-1 mx-1">
                <input
                  type="number"
                  min="1"
                  max={pagination.totalPages}
                  value={page}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isInteger(v) && v >= 1 && v <= pagination.totalPages) setPage(v);
                  }}
                  className="w-16 text-center px-1.5 py-1 text-xs border border-zinc-300 rounded tabular-nums"
                />
                <span className="text-xs text-zinc-400">/ {pagination.totalPages.toLocaleString()}</span>
              </div>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={pagination.page >= pagination.totalPages || loading}
                className="px-2.5 py-1 text-xs border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                次へ ›
              </button>
              <button
                onClick={() => setPage(pagination.totalPages)}
                disabled={pagination.page >= pagination.totalPages || loading}
                className="px-2.5 py-1 text-xs border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="最後のページ"
              >
                最後 »
              </button>
            </div>
          </div>
        )}
      </div>

      {showImport && (
        <CustomerCsvImportModal
          onClose={() => setShowImport(false)}
          onCompleted={() => { setShowImport(false); reload(); }}
        />
      )}

      {detail && (
        <CustomerDetailModal
          customerId={detail.id}
          initialTab={detail.initialTab}
          channelFilter={detail.channelFilter}
          onClose={() => setDetail(null)}
          onUpdated={reload}
        />
      )}
    </div>
  );
}
