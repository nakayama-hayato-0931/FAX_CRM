import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import CustomerCsvImportModal from '@/components/CustomerCsvImportModal';

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
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', industry: '', prefecture: '', blacklisted: '' });
  const [industries, setIndustries] = useState([]);
  const [prefectures, setPrefectures] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [syncPulling, setSyncPulling] = useState(false);
  const [syncPushing, setSyncPushing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (isDemo) return;
    api.get('/api/customers/sync/status')
      .then((r) => setSyncStatus(r.data?.data || null))
      .catch(() => {});
  }, [isDemo]);

  const pullFromCallcenter = async () => {
    if (isDemo) { toast('デモ表示中は同期されません', { icon: 'ℹ' }); return; }
    if (!syncStatus?.configured) {
      toast.error('callcenter 連携が未設定 (環境変数 CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN を設定してください)');
      return;
    }
    setSyncPulling(true);
    try {
      const { data } = await api.post('/api/customers/sync/pull');
      const r = data.data || {};
      toast.success(`callcenter→fax-crm: 取得${r.fetched ?? 0} / 新規${r.inserted ?? 0} / 紐付け${r.linked ?? 0} / 更新${r.updated ?? 0}`);
      reload();
    } catch (e) {
      toast.error(e.userMessage || 'callcenter からの取り込み失敗');
    } finally { setSyncPulling(false); }
  };

  const pushToCallcenter = async () => {
    if (isDemo) { toast('デモ表示中は同期されません', { icon: 'ℹ' }); return; }
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
        const params = { page: 1, pageSize: 50 };
        if (filters.q) params.q = filters.q;
        if (filters.industry) params.industry = filters.industry;
        if (filters.prefecture) params.prefecture = filters.prefecture;
        if (filters.blacklisted !== '') params.blacklisted = filters.blacklisted;
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
  }, [isDemo, reloadKey, filters.industry, filters.prefecture, filters.blacklisted]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">顧客マスタ</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            {pagination.total.toLocaleString()} 件
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={reload} className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            再読み込み
          </button>
          <button
            onClick={pullFromCallcenter}
            disabled={syncPulling || (syncStatus && !syncStatus.configured)}
            className="px-3 py-2 text-sm bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50"
            title={syncStatus?.configured
              ? 'callcenter-ai-system の企業マスタを取り込み (肉付けマージ)'
              : 'callcenter 連携 未設定 (env: CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN)'}
          >
            {syncPulling ? '取込中…' : 'callcenter から取込'}
          </button>
          <button
            onClick={pushToCallcenter}
            disabled={syncPushing || (syncStatus && !syncStatus.configured)}
            className="px-3 py-2 text-sm bg-sky-700 text-white rounded-md hover:bg-sky-800 disabled:opacity-50"
            title={syncStatus?.configured
              ? 'fax-crm の顧客を callcenter へ送信 (新規作成 or 更新)'
              : 'callcenter 連携 未設定'}
          >
            {syncPushing ? '送信中…' : 'callcenter へ送信'}
          </button>
          <button onClick={() => setShowImport(true)}
                  className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            CSVインポート
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
          <select className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                  value={filters.prefecture}
                  onChange={(e) => setFilters({ ...filters, prefecture: e.target.value })}>
            <option value="">都道府県 (すべて)</option>
            {prefectures.map((p) => (
              <option key={p.prefecture} value={p.prefecture}>{p.prefecture} ({p.cnt})</option>
            ))}
          </select>
          <select className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                  value={filters.blacklisted}
                  onChange={(e) => setFilters({ ...filters, blacklisted: e.target.value })}>
            <option value="">B/L: すべて</option>
            <option value="false">通常のみ</option>
            <option value="true">ブラックリストのみ</option>
          </select>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                  onClick={reload}>検索</button>
          <button className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded-md"
                  onClick={() => {
                    setFilters({ q: '', industry: '', prefecture: '', blacklisted: '' });
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
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">業種</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">都道府県</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">送信回数</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">最終送信</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">直近結果</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase tracking-wider">状態</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-400">読み込み中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-400">
                  顧客データがありません。「CSVインポート」から取り込んでください。
                </td></tr>
              )}
              {!loading && items.map((c) => (
                <tr key={c.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="px-4 py-2.5">
                    <Link href={`/customers/${c.id}${isDemo ? '?demo=1' : ''}`}
                          className="text-indigo-700 hover:underline font-medium">
                      {c.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-700">{c.fax_number}</td>
                  <td className="px-4 py-2.5 text-zinc-700">{c.industry || '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-700">{c.prefecture || '—'}</td>
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 text-sm">
            <div className="text-zinc-500">
              ページ {pagination.page} / {pagination.totalPages}
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
    </div>
  );
}
