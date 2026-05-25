import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import ManuscriptContentRegisterModal from '@/components/ManuscriptContentRegisterModal';
import ManuscriptContentDetailModal from '@/components/ManuscriptContentDetailModal';

const NATIONALITIES = ['ベトナム','ミャンマー','ネパール','モンゴル','スリランカ','バングラディシュ'];
const GENDERS = ['男','女'];
const INDUSTRIES = ['飲食','製造','小売','宿泊','建設','その他'];

export default function ScriptsPage() {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pageSize: 50, totalPages: 0 });
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ q: '', nationality: '', gender: '', industry: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [showRegister, setShowRegister] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/api/manuscript-contents', {
          params: { ...filters, page: 1, pageSize: 50 },
        });
        if (cancelled) return;
        setItems(data.data || []);
        setPagination(data.meta?.pagination || { total: data.data?.length || 0, page: 1, pageSize: 50, totalPages: 1 });
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey, filters.nationality, filters.gender, filters.industry]);

  const date = (v) => v ? new Date(v).toLocaleDateString('ja-JP') : '—';

  const removeManuscript = async (r) => {
    const usageNote = Number(r.usage_total_sent || 0) > 0
      ? `\n注意: 送信合計 ${Number(r.usage_total_sent).toLocaleString()} 件 / 問合せ ${Number(r.usage_total_inquiry || 0)} 件 / 発注 ${Number(r.usage_total_order || 0)} 件 の使用記録も同時に削除されます。`
      : '';
    const label = r.title || `原稿 #${r.id}`;
    if (!window.confirm(`原稿「${label}」を削除します。${usageNote}\nPDF も Drive / ローカルから削除されます。\nよろしいですか？`)) return;
    try {
      await api.delete(`/api/manuscript-contents/${r.id}`);
      toast.success('削除しました');
      reload();
    } catch (e) {
      toast.error(e.userMessage || '削除失敗');
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">原稿管理</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            {pagination.total.toLocaleString()} 件 / PDF原稿 + メタデータ(登録番号・国籍・性別・業種) + 使用記録
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reload} className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">再読み込み</button>
          <button onClick={() => setShowRegister(true)}
                  className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">+ 原稿を登録</button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-4 gap-3">
          <input type="text" placeholder="検索 (タイトル/登録番号/メモ)" value={filters.q}
                 onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                 onKeyDown={(e) => e.key === 'Enter' && reload()}
                 className="rep-input col-span-2" />
          <select value={filters.nationality} onChange={(e) => setFilters({ ...filters, nationality: e.target.value })} className="rep-input">
            <option value="">国籍 (すべて)</option>
            {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={filters.industry} onChange={(e) => setFilters({ ...filters, industry: e.target.value })} className="rep-input">
            <option value="">業種 (すべて)</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={filters.gender} onChange={(e) => setFilters({ ...filters, gender: e.target.value })} className="rep-input">
            <option value="">性別 (すべて)</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={reload} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">検索</button>
            <button onClick={() => { setFilters({ q: '', nationality: '', gender: '', industry: '' }); setTimeout(reload, 0); }}
                    className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded-md">クリア</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600">タイトル / 登録番号</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600">国籍</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600">性別</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600">業種</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-zinc-600">送信日数</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-zinc-600">送信合計</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-zinc-600">問合せ</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-zinc-600">発注</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600">最終使用</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600">PDF</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-zinc-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="px-3 py-12 text-center text-zinc-400">読み込み中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-12 text-center text-zinc-400">
                  原稿がまだ登録されていません。「+ 原稿を登録」 から PDF + メタデータを保存できます。
                </td></tr>
              )}
              {!loading && items.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="px-3 py-2.5">
                    <button onClick={() => setDetailId(r.id)} className="text-indigo-700 hover:underline font-medium text-left block">
                      {r.title || `原稿 #${r.id}`}
                    </button>
                    {r.registration_no && <div className="text-xs text-zinc-500 font-mono">{r.registration_no}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">{r.nationality || '—'}</td>
                  <td className="px-3 py-2.5 text-zinc-700">{r.gender || '—'}</td>
                  <td className="px-3 py-2.5 text-zinc-700">{r.industry_category || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.usage_send_days || 0}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.usage_total_sent || 0}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.usage_total_inquiry || 0}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.usage_total_order || 0}</td>
                  <td className="px-3 py-2.5 text-zinc-500 text-xs">{date(r.last_used_date)}</td>
                  <td className="px-3 py-2.5">
                    {r.pdf_file_path ? (
                      <a href={`${api.defaults.baseURL || ''}/api/manuscript-contents/${r.id}/pdf`}
                         target="_blank" rel="noreferrer"
                         className="text-indigo-600 hover:text-indigo-800 underline text-xs">開く</a>
                    ) : <span className="text-zinc-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => removeManuscript(r)}
                      className="px-2 py-1 text-xs bg-white border border-red-200 text-red-700 rounded hover:bg-red-50"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showRegister && (
        <ManuscriptContentRegisterModal
          onClose={() => setShowRegister(false)}
          onCompleted={(rec) => { setShowRegister(false); reload(); if (rec) setDetailId(rec.id); }}
        />
      )}
      {detailId && (
        <ManuscriptContentDetailModal
          manuscriptId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={reload}
        />
      )}

      <style jsx global>{`
        .rep-input { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 6px 10px; font-size: 13px; background: white; }
        .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
      `}</style>
    </div>
  );
}
