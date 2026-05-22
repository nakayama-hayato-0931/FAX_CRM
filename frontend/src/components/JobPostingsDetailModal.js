import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * 月別の求人内訳モーダル (案件数/バラシのクリックで開く)
 *   - month: 'YYYY-MM-01'
 *   - monthLabel: '2026年5月'
 *   - filter: 'all' | 'cancelled' (バラシのみ)
 *   - expectedCount?: number
 */
export default function JobPostingsDetailModal({ month, monthLabel, filter = 'all', expectedCount, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/api/job-postings', {
          params: { month, filter, limit: 2000 },
        });
        if (!cancelled) setRows(data.data || []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.userMessage || '求人一覧の取得に失敗しました');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month, filter]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const date = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  };

  const cancelledCount = rows.filter((r) => r.is_cancelled).length;
  const headerLabel = filter === 'cancelled' ? 'バラシ内訳' : '案件内訳';

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[1200px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              {headerLabel} — {monthLabel}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              『求人情報』 シートより / 抽出条件: H='FAX受電'{filter === 'cancelled' ? ' AND AI=バラシ' : ''} / 月キー: AJ列(案件獲得日)
              {!loading && (
                <span className="ml-2">
                  <strong className="text-zinc-700">{rows.length}</strong> 件
                  {filter === 'all' && cancelledCount > 0 && (
                    <span className="text-zinc-500 ml-1">(うちバラシ {cancelledCount}件)</span>
                  )}
                  {expectedCount != null && expectedCount !== rows.length && (
                    <span className="text-amber-600 ml-2">(CPA表: {expectedCount}件)</span>
                  )}
                </span>
              )}
            </p>
          </div>
          <button
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none"
            onClick={onClose}
            title="閉じる (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="text-center text-zinc-400 py-12">読み込み中…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-center text-zinc-400 py-12">この月の{filter === 'cancelled' ? 'バラシ' : '案件'}はありません</div>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10">
                <tr>
                  {filter === 'all' && <Th>状態<br/><span className="text-[10px] text-zinc-400">AI列</span></Th>}
                  <Th>案件獲得日<br/><span className="text-[10px] text-zinc-400">AJ列</span></Th>
                  <Th>求人番号<br/><span className="text-[10px] text-zinc-400">C列</span></Th>
                  <Th>会社名<br/><span className="text-[10px] text-zinc-400">D列</span></Th>
                  <Th>営業担当<br/><span className="text-[10px] text-zinc-400">B列</span></Th>
                  <Th>業種<br/><span className="text-[10px] text-zinc-400">I列</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={[
                      'border-t border-zinc-100 hover:bg-zinc-50/60',
                      r.is_cancelled ? 'bg-red-50/30 text-zinc-500' : '',
                    ].join(' ')}
                  >
                    {filter === 'all' && (
                      <Td>
                        {r.is_cancelled
                          ? <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700 font-medium">バラシ</span>
                          : <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-700 font-medium">通常</span>}
                      </Td>
                    )}
                    <Td>{date(r.acquired_date)}</Td>
                    <Td className="font-mono">{r.job_number || '—'}</Td>
                    <Td className="max-w-[300px] truncate" title={r.company_name || ''}>{r.company_name || '—'}</Td>
                    <Td>{r.sales_owner || '—'}</Td>
                    <Td>{r.industry || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children }) {
  return <th className="px-2.5 py-2 font-medium text-zinc-600 whitespace-nowrap text-left">{children}</th>;
}
function Td({ children, className = '' }) {
  return <td className={['px-2.5 py-1.5 text-zinc-800 whitespace-nowrap text-left', className].join(' ')}>{children}</td>;
}
