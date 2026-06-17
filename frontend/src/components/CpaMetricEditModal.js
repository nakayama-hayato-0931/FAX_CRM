import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * CPA 指標 月別 手動上書きモーダル (汎用)
 *
 * 案件数 / 面接数 / 内定社数 / バラシ / 初回入金 / 見込売上 / 入金実績 のいずれかを
 * 月別に手動上書きする。 空欄 = 自動集計 (シート同期由来) に戻す。
 *
 * Props:
 *   - month: 'YYYY-MM-01'
 *   - monthLabel: '2026年5月'
 *   - metricKey: 'projects' | 'interviews' | 'offers' | 'cancels'
 *                | 'first_payment' | 'expected_revenue' | 'payment_actual'
 *   - metricLabel: 表示ラベル (例: '案件数')
 *   - autoValue: 自動算出値 (number)
 *   - currentValue: 表示中の現値 (auto or manual)
 *   - isManual: 0|1
 *   - unit: 'count' | 'yen'
 *   - onClose, onSaved
 */
const UNIT_LABEL = { count: '件', yen: '円' };

export default function CpaMetricEditModal({ month, monthLabel, metricKey, metricLabel,
                                             autoValue, currentValue, isManual, unit,
                                             onClose, onSaved }) {
  const [value, setValue] = useState(isManual ? String(currentValue ?? '') : '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const parseNum = (v) => (v === '' ? null : Number(String(v).replace(/[¥,\s]/g, '')));
  const num = parseNum(value);

  const save = async () => {
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      toast.error(`${metricLabel} は 0以上の数値、 または空 (自動集計に戻す)`); return;
    }
    setBusy(true);
    try {
      await api.put(`/api/cpa/monthly-metrics/${month}`, { [metricKey]: num });
      toast.success(`${metricLabel} を保存しました`);
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '保存失敗'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm(`${monthLabel} の ${metricLabel} 手動上書きを削除して、 自動集計に戻します。 よろしいですか？`)) return;
    setBusy(true);
    try {
      await api.put(`/api/cpa/monthly-metrics/${month}`, { [metricKey]: null });
      toast.success(`${metricLabel} を自動集計に戻しました`);
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '削除失敗'); }
    finally { setBusy(false); }
  };

  const fmt = (v) => {
    if (v == null || isNaN(v)) return '—';
    const prefix = unit === 'yen' ? '¥' : '';
    const suffix = unit === 'count' ? '' : '';
    return `${prefix}${Number(v).toLocaleString()}${suffix}`;
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold text-zinc-900">
            {metricLabel} 手動上書き — {monthLabel}
          </h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <p className="text-[11px] text-zinc-500 leading-relaxed bg-sky-50 border border-sky-100 rounded p-2.5">
            空欄なら シート同期の自動算出値が使われます。 数値を入れると その月は 手動値で上書きされ、 同期しても勝手に戻りません (「自動集計に戻す」 で削除するまで保持)。
          </p>

          <div className="bg-zinc-50 border border-zinc-200 rounded p-3 flex justify-between items-center text-xs">
            <span className="text-zinc-600">自動算出値 (参考):</span>
            <span className="tabular-nums font-semibold text-zinc-900">{fmt(autoValue)}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">
              {metricLabel} 手動上書き値 <span className="text-zinc-400">({UNIT_LABEL[unit]})</span>
            </label>
            <input type="text" inputMode="numeric" value={value}
                   onChange={(e) => setValue(e.target.value)}
                   placeholder={autoValue != null ? String(autoValue) : '空欄 = 自動集計'}
                   disabled={busy}
                   autoFocus
                   className="w-full border border-zinc-300 rounded px-3 py-2 text-right tabular-nums text-base" />
            {num != null && Number.isFinite(num) && num >= 0 && (
              <div className="text-[10px] text-zinc-500 mt-1 text-right">
                保存値: {fmt(Math.round(num))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-between items-center">
          <button type="button" onClick={reset}
                  disabled={busy || !isManual}
                  className="px-3 py-1.5 text-sm bg-white border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-30">
            自動集計に戻す
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
              キャンセル
            </button>
            <button type="button" onClick={save} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
