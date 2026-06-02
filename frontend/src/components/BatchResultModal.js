import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * 抽出バッチの結果表示モーダル
 *   - GET /api/batches/:id → { batch, customers } を表示
 *   - Excel ダウンロードも auth 付きで行う (window.open だと Authorization が乗らず 401)
 */
export default function BatchResultModal({ batchId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: r } = await api.get(`/api/batches/${batchId}`);
        if (!cancelled) setData(r.data || null);
      } catch (e) {
        if (!cancelled) toast.error(e.userMessage || '結果の取得に失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [batchId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // auth ヘッダ付きで Excel を blob 取得 → ローカル DL 起動
  const downloadExcel = async () => {
    if (!data?.batch) return;
    setDownloading(true);
    try {
      const res = await api.get(`/api/batches/${batchId}/excel`, { responseType: 'blob' });
      // Content-Disposition から filename を抽出 (取れなければバッチ名で fallback)
      const cd = res.headers['content-disposition'] || '';
      let fileName = '';
      const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
      if (m && m[1]) fileName = decodeURIComponent(m[1]);
      if (!fileName) fileName = `${(data.batch.name || `batch_${batchId}`).replace(/[\\/:*?"<>|]/g, '_')}.xlsx`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.userMessage || 'Excel ダウンロード失敗');
    } finally {
      setDownloading(false);
    }
  };

  const customers = data?.customers || [];
  const filtered = q
    ? customers.filter((c) => {
        const haystack = [c.company_name, c.fax_number, c.phone_number,
                          c.industry, c.prefecture, c.city, c.address].filter(Boolean).join(' ');
        return haystack.includes(q);
      })
    : customers;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[1200px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              {data?.batch?.is_test ? (
                <span className="mr-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-200 text-amber-900 font-bold align-middle">TEST</span>
              ) : null}
              {data?.batch?.name || '読み込み中…'}
            </h2>
            {data?.batch && (
              <p className="text-zinc-500 mt-1 text-xs">
                バッチID: {data.batch.id} /
                抽出 <span className="font-semibold">{data.batch.actual_count?.toLocaleString() || 0}</span> 件
                {data.batch.pc_number && <> / PC: <span className="font-mono">{data.batch.pc_number}</span></>}
                {data.batch.filter_industry && <> / 業種: {data.batch.filter_industry}</>}
                {data.batch.filter_prefecture && <> / 都道府県: {data.batch.filter_prefecture}</>}
                {data.batch.created_at && <> / 作成: {new Date(data.batch.created_at).toLocaleString('ja-JP', { hour12: false })}</>}
              </p>
            )}
          </div>
          <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} title="閉じる (Esc)">
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-zinc-200 flex items-center gap-3 flex-shrink-0">
          <input
            type="text" placeholder="会社名 / FAX / 電話 / 住所 で絞り込み"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 border border-zinc-300 rounded-md px-3 py-1.5 text-sm"
          />
          <div className="text-xs text-zinc-500 tabular-nums">
            表示 {filtered.length.toLocaleString()} / {customers.length.toLocaleString()} 件
          </div>
          <button
            onClick={downloadExcel}
            disabled={loading || downloading || !customers.length}
            className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
          >
            {downloading ? 'DL中…' : 'Excel ダウンロード'}
          </button>
        </div>

        {/* Body: Customer table */}
        <div className="flex-1 overflow-auto px-6 py-3">
          {loading ? (
            <div className="text-center text-zinc-400 py-12 text-sm">読み込み中…</div>
          ) : customers.length === 0 ? (
            <div className="text-center text-zinc-400 py-12 text-sm">抽出された顧客がありません</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="bg-zinc-50 sticky top-0 z-10">
                <tr className="border-b border-zinc-200">
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-600 w-12">No.</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">会社名</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-32">FAX</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-32">電話</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-20">業種</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-20">都道府県</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">住所</th>
                  <th className="text-right px-2 py-2 text-xs font-medium text-zinc-600 w-14">送信</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.row_index || c.id}
                      className={[
                        'border-b border-zinc-100 hover:bg-zinc-50/60',
                        c.is_blacklisted ? 'bg-red-50/60' : '',
                      ].join(' ')}>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500 text-xs">{c.row_index}</td>
                    <td className="px-3 py-1.5 text-zinc-900 font-medium">{c.company_name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-zinc-700">
                      {c.fax_number || <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-zinc-700">
                      {c.phone_number || <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-700">{c.industry || '—'}</td>
                    <td className="px-3 py-1.5 text-zinc-700">{c.prefecture || '—'}</td>
                    <td className="px-3 py-1.5 text-zinc-600 text-xs">
                      {[c.city, c.address].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500 text-xs">{c.send_count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
