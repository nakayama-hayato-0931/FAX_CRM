import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * 月別の面接内訳モーダル
 * Props:
 *   - month: 'YYYY-MM-01'
 *   - monthLabel: '2026年5月'
 *   - expectedCount?: number (CPA表の値、参考表示)
 *   - basis: 'acquired' | 'offer'
 *   - kind?: 'all' (既定) | 'rejects'  ※ rejects は 不合格 のみフィルタ
 *   - onClose: () => void
 */
export default function InterviewsDetailModal({ month, monthLabel, expectedCount, basis = 'acquired', kind = 'all', onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const isRejects = kind === 'rejects';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/api/interviews', {
          params: { month, basis, kind, limit: 2000 },
        });
        if (!cancelled) setRows(data.data || []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.userMessage || '面接一覧の取得に失敗しました');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month, basis, kind]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const num = (v) => (v == null ? '—' : Number(v).toLocaleString());
  const date = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  };

  const totalInterviewers = rows.reduce((a, r) => a + Number(r.interview_count || 0), 0);
  const totalPasses = rows.reduce((a, r) => a + Number(r.pass_count || 0), 0);
  const passRate = totalInterviewers > 0 ? Math.round((totalPasses / totalInterviewers) * 1000) / 10 : null;
  // 面接した会社数 = DISTINCT 求人番号 (CPA表の「面接数」 と一致するロジック)
  const distinctJobKeys = new Set(rows.map((r) => r.job_number || r.company_name || `__row${r.id}`));
  const distinctCompanyCount = distinctJobKeys.size;

  const basisLabel = basis === 'offer' ? '面接日(NM列)' : '案件取得日(NS列)';

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[1200px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              {isRejects ? '不合格 内訳' : '面接内訳'} — {monthLabel}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              『2024_面接内訳』 シートより / 抽出条件: NR='FAX受電' AND 面接日≦当日
              AND NOT (面接人数=0 AND 合格=0/空欄)
              {isRejects && ' AND (NQ=0 OR (NQ空欄 AND NM≦今日-1ヶ月))'}
              {' '}/ 月キー: {basisLabel}
              {!loading && (
                <span className="ml-2">
                  {isRejects
                    ? <>不合格 <strong className="text-red-700">{distinctCompanyCount}</strong> 社 / 行 {rows.length} 件</>
                    : <>面接 <strong className="text-zinc-700">{distinctCompanyCount}</strong> 社
                        / 面接人数 {totalInterviewers} 名 / 合格 {totalPasses} 名
                        {passRate != null && <span className="ml-1">(合格率 {passRate}%)</span>}</>}
                  {expectedCount != null && expectedCount !== distinctCompanyCount && (
                    <span className="text-amber-600 ml-2">(CPA表: {expectedCount})</span>
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

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="text-center text-zinc-400 py-12">読み込み中…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-center text-zinc-400 py-12">
              この月の面接記録はありません
            </div>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10">
                <tr>
                  <Th>面接日<br/><span className="text-[10px] text-zinc-400">NM列</span></Th>
                  <Th>案件取得日<br/><span className="text-[10px] text-zinc-400">NS列</span></Th>
                  <Th>求人番号<br/><span className="text-[10px] text-zinc-400">NN列</span></Th>
                  <Th>企業名<br/><span className="text-[10px] text-zinc-400">NO列</span></Th>
                  <Th>営業担当<br/><span className="text-[10px] text-zinc-400">NL列</span></Th>
                  <Th>業種<br/><span className="text-[10px] text-zinc-400">NU列</span></Th>
                  <Th align="right">面接人数<br/><span className="text-[10px] text-zinc-400">NP列</span></Th>
                  <Th align="right">合格者数<br/><span className="text-[10px] text-zinc-400">NQ列</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const key = r.job_number || r.company_name || `__row${r.id}`;
                  const prevKey = idx > 0 ? (rows[idx - 1].job_number || rows[idx - 1].company_name || `__row${rows[idx - 1].id}`) : null;
                  const isGroupStart = key !== prevKey;
                  return (
                    <tr
                      key={r.id}
                      className={[
                        isGroupStart ? 'border-t-2 border-zinc-300' : 'border-t border-zinc-100/50',
                        'hover:bg-zinc-50/60',
                      ].join(' ')}
                    >
                      <Td>{date(r.interview_date)}</Td>
                      <Td>{date(r.acquired_date)}</Td>
                      <Td className="font-mono">
                        {isGroupStart ? (r.job_number || '—') : <span className="text-zinc-300">″</span>}
                      </Td>
                      <Td className="max-w-[260px] truncate" title={r.company_name || ''}>
                        {isGroupStart ? (r.company_name || '—') : <span className="text-zinc-300">″</span>}
                      </Td>
                      <Td>{r.sales_owner || '—'}</Td>
                      <Td>{isGroupStart ? (r.industry || '—') : <span className="text-zinc-300">″</span>}</Td>
                      <Td align="right" className="tabular-nums">{num(r.interview_count)}</Td>
                      <Td align="right" className="tabular-nums">{num(r.pass_count)}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-zinc-50 border-t-2 border-zinc-300 sticky bottom-0">
                <tr className="font-semibold">
                  <Td colSpan={6} align="right" className="text-zinc-700">
                    面接 <strong>{distinctCompanyCount}</strong> 社 / 行 {rows.length} 件
                  </Td>
                  <Td align="right" className="tabular-nums">{num(totalInterviewers)}</Td>
                  <Td align="right" className="tabular-nums">{num(totalPasses)}</Td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th className={[
      'px-2.5 py-2 font-medium text-zinc-600 whitespace-nowrap',
      align === 'right' ? 'text-right' : 'text-left',
    ].join(' ')}>{children}</th>
  );
}

function Td({ children, align = 'left', className = '', colSpan }) {
  return (
    <td colSpan={colSpan} className={[
      'px-2.5 py-1.5 text-zinc-800 whitespace-nowrap',
      align === 'right' ? 'text-right' : 'text-left',
      className,
    ].join(' ')}>{children}</td>
  );
}
