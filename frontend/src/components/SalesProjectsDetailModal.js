import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * 月別の内定社内訳(案件一覧)モーダル
 * Props:
 *   - month: 'YYYY-MM-01' (acquired_date の月初)
 *   - monthLabel: 表示用 (例: '2026年5月')
 *   - expectedCount?: number (CPA表上の件数。整合確認用に表示)
 *   - onClose: () => void
 */
export default function SalesProjectsDetailModal({ month, monthLabel, expectedCount, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 内定 = 取消/辞退も含む全件 (売上は0として記録済み)
        const { data } = await api.get('/api/sales-projects', {
          params: { month, status: 'all', limit: 1000 },
        });
        if (!cancelled) setRows(data.data || []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.userMessage || '案件一覧の取得に失敗しました');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month]);

  // ESCで閉じる
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const yen = (v) => (v == null ? '—' : '¥' + Number(v).toLocaleString());
  const date = (v) => {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  };

  // 合計
  const totalFirstPayment = rows.reduce((a, r) => a + Number(r.first_payment || 0), 0);
  const totalExpectedRevenue = rows.reduce((a, r) => a + Number(r.expected_revenue || 0), 0);
  const totalPaymentActual = rows.reduce((a, r) => a + Number(r.payment_actual || 0), 0);

  // 求人番号の DISTINCT 数 (= 内定社数の定義)
  const distinctJobKeys = new Set(rows.map((r) => r.job_number || r.company_name || `__row${r.id}`));
  const distinctCompanyCount = distinctJobKeys.size;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-[1280px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              内定社内訳 — {monthLabel}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              案件シート(『ビザ申請 進捗』)より / 取消・辞退も含む全件 (売上は0で記録)
              {!loading && (
                <span className="ml-2">
                  内定社 <strong className="text-zinc-700">{distinctCompanyCount}</strong> 社 / 候補者 {rows.length} 名
                  {expectedCount != null && expectedCount !== distinctCompanyCount && (
                    <span className="text-amber-600 ml-1">(CPA表: {expectedCount} 社)</span>
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
              この月の内定案件はありません
            </div>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10">
                <tr>
                  <Th>状態<br/><span className="text-[10px] text-zinc-400">J列</span></Th>
                  <Th>内定日<br/><span className="text-[10px] text-zinc-400">A列</span></Th>
                  <Th>案件取得日<br/><span className="text-[10px] text-zinc-400">BK列</span></Th>
                  <Th>求人番号<br/><span className="text-[10px] text-zinc-400">B列</span></Th>
                  <Th>会社名<br/><span className="text-[10px] text-zinc-400">BD列</span></Th>
                  <Th>登録番号<br/><span className="text-[10px] text-zinc-400">G列</span></Th>
                  <Th>営業担当<br/><span className="text-[10px] text-zinc-400">E列</span></Th>
                  <Th>業種<br/><span className="text-[10px] text-zinc-400">CF列</span></Th>
                  <Th align="right">初回入金<br/><span className="text-[10px] text-zinc-400">BI列</span></Th>
                  <Th align="right">見込売上<br/><span className="text-[10px] text-zinc-400">BJ列</span></Th>
                  <Th align="right">入金実績<br/><span className="text-[10px] text-zinc-400">CC列</span></Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isZero = r.is_cancelled || r.is_declined;
                  const key = r.job_number || r.company_name || `__row${r.id}`;
                  const prevKey = idx > 0 ? (rows[idx - 1].job_number || rows[idx - 1].company_name || `__row${rows[idx - 1].id}`) : null;
                  const nextKey = idx < rows.length - 1 ? (rows[idx + 1].job_number || rows[idx + 1].company_name || `__row${rows[idx + 1].id}`) : null;
                  const isGroupStart = key !== prevKey;
                  const isGroupContinue = key === prevKey || key === nextKey;
                  return (
                    <tr
                      key={r.id}
                      className={[
                        isGroupStart ? 'border-t-2 border-zinc-300' : 'border-t border-zinc-100/50',
                        'hover:bg-zinc-50/60',
                        isZero ? 'bg-zinc-50/40 text-zinc-500' : '',
                      ].join(' ')}
                    >
                      <Td><StatusBadge row={r} /></Td>
                      <Td>{date(r.offer_date)}</Td>
                      <Td>{date(r.acquired_date)}</Td>
                      <Td className="font-mono">
                        {isGroupStart ? (r.job_number || '—') : <span className="text-zinc-300">″</span>}
                      </Td>
                      <Td className="max-w-[200px] truncate" title={r.company_name || ''}>
                        {isGroupStart ? (r.company_name || '—') : <span className="text-zinc-300">″</span>}
                      </Td>
                      <Td className="font-mono">{r.candidate_registration_no || '—'}</Td>
                      <Td>{r.sales_owner || '—'}</Td>
                      <Td>{isGroupStart ? (r.industry || '—') : <span className="text-zinc-300">″</span>}</Td>
                      <Td align="right" className="tabular-nums">{yen(r.first_payment)}</Td>
                      <Td align="right" className="tabular-nums">{yen(r.expected_revenue)}</Td>
                      <Td align="right" className="tabular-nums">{yen(r.payment_actual)}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-zinc-50 border-t-2 border-zinc-300 sticky bottom-0">
                <tr className="font-semibold">
                  <Td colSpan={8} align="right" className="text-zinc-700">
                    内定 <strong>{distinctCompanyCount}</strong> 社 / 候補者 {rows.length} 名
                    {rows.some((r) => r.is_cancelled || r.is_declined) && (
                      <span className="text-zinc-500 font-normal">
                        {' '}(取消 {rows.filter((r) => r.is_cancelled).length} / 辞退 {rows.filter((r) => r.is_declined).length})
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="tabular-nums">{yen(totalFirstPayment)}</Td>
                  <Td align="right" className="tabular-nums">{yen(totalExpectedRevenue)}</Td>
                  <Td align="right" className="tabular-nums">{yen(totalPaymentActual)}</Td>
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

function StatusBadge({ row }) {
  if (row.is_cancelled) {
    return <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700 font-medium">取消</span>;
  }
  if (row.is_declined) {
    return <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 font-medium">辞退</span>;
  }
  return <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-emerald-100 text-emerald-700 font-medium">通常</span>;
}

function Th({ children, align = 'left' }) {
  return (
    <th
      className={[
        'px-2.5 py-2 font-medium text-zinc-600 whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
      ].join(' ')}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left', className = '', colSpan }) {
  return (
    <td
      colSpan={colSpan}
      className={[
        'px-2.5 py-1.5 text-zinc-800 whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}
