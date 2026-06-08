import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * CPA 受電数 月別 手動入力モーダル
 *   - 受電 (incoming_picked_manual) / 不在 (incoming_missed_manual) を手動上書き
 *   - 空欄なら zp_* (Zoom Phone) の自動集計 (2ヶ月クールダウン dedup) が使われる
 *
 * Props:
 *   - month: 'YYYY-MM-01'
 *   - monthLabel: '2026年5月'
 *   - row: 当該月の CPA row (incoming_picked, incoming_missed,
 *          incoming_picked_is_manual, incoming_missed_is_manual)
 *   - onClose, onSaved
 */
export default function CpaIncomingInputModal({ month, monthLabel, row, onClose, onSaved }) {
  const [pickedValue, setPickedValue] = useState(
    row?.incoming_picked_is_manual ? String(row.incoming_picked ?? '') : ''
  );
  const [missedValue, setMissedValue] = useState(
    row?.incoming_missed_is_manual ? String(row.incoming_missed ?? '') : ''
  );
  const [busy, setBusy] = useState(false);

  // 自動集計の参考値 (手動が入っていない時の現値)
  const autoPicked = row?.incoming_picked_is_manual ? null : Number(row?.incoming_picked ?? 0);
  const autoMissed = row?.incoming_missed_is_manual ? null : Number(row?.incoming_missed ?? 0);
  const hasManual = !!(row?.incoming_picked_is_manual || row?.incoming_missed_is_manual);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // 既存の手動値を取得 (row に乗っていない場合の保険)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/cpa/monthly-cost/${month}`);
        if (cancelled || !data.data) return;
        const mp = data.data.incoming_picked_manual;
        const mm = data.data.incoming_missed_manual;
        if (mp != null) setPickedValue(String(mp));
        if (mm != null) setMissedValue(String(mm));
      } catch (_) { /* no-op */ }
    })();
    return () => { cancelled = true; };
  }, [month]);

  const parseNum = (v) => (v === '' ? null : Number(v));
  const pNum = parseNum(pickedValue);
  const mNum = parseNum(missedValue);
  const effPicked = pNum != null && Number.isFinite(pNum) && pNum >= 0 ? Math.round(pNum) : (autoPicked ?? 0);
  const effMissed = mNum != null && Number.isFinite(mNum) && mNum >= 0 ? Math.round(mNum) : (autoMissed ?? 0);

  const save = async () => {
    if (pNum != null && (!Number.isFinite(pNum) || pNum < 0)) { toast.error('受電 は 0以上の数値、 または空 (自動集計)'); return; }
    if (mNum != null && (!Number.isFinite(mNum) || mNum < 0)) { toast.error('不在 は 0以上の数値、 または空 (自動集計)'); return; }
    setBusy(true);
    try {
      await api.put(`/api/cpa/monthly-incoming/${month}`, {
        incoming_picked_manual: pNum,
        incoming_missed_manual: mNum,
      });
      toast.success('受電数 を保存しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '受電数の保存失敗'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm(`${monthLabel} の受電数 手動入力を削除して 自動集計 (zp_*) に戻します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await api.put(`/api/cpa/monthly-incoming/${month}`, {
        incoming_picked_manual: null,
        incoming_missed_manual: null,
      });
      toast.success('受電数 を自動集計に戻しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '削除失敗'); }
    finally { setBusy(false); }
  };

  const num = (v) => Number(v).toLocaleString();

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold text-zinc-900">受電数 入力 — {monthLabel}</h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <p className="text-[11px] text-zinc-500 leading-relaxed bg-sky-50 border border-sky-100 rounded p-2.5">
            空欄なら zp_* (Zoom Phone) の自動集計 (2ヶ月クールダウン dedup 適用) が使われます。
            数値を入れると その月は手動値で上書きされます。
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                受電 {autoPicked != null && <span className="text-[10px] text-zinc-400">(自動: {num(autoPicked)})</span>}
              </label>
              <input type="text" inputMode="numeric" value={pickedValue}
                     onChange={(e) => setPickedValue(e.target.value)}
                     placeholder={autoPicked != null ? String(autoPicked) : '自動集計'}
                     disabled={busy}
                     className="w-full border border-zinc-300 rounded px-3 py-2 text-right tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                不在 {autoMissed != null && <span className="text-[10px] text-zinc-400">(自動: {num(autoMissed)})</span>}
              </label>
              <input type="text" inputMode="numeric" value={missedValue}
                     onChange={(e) => setMissedValue(e.target.value)}
                     placeholder={autoMissed != null ? String(autoMissed) : '自動集計'}
                     disabled={busy}
                     className="w-full border border-zinc-300 rounded px-3 py-2 text-right tabular-nums" />
            </div>
          </div>

          <div className="bg-zinc-50 border border-zinc-200 rounded p-3 text-xs flex justify-between items-center">
            <span className="text-zinc-600">受電数 合計 (受電 + 不在):</span>
            <span className="tabular-nums font-semibold text-base text-zinc-900">{num(effPicked + effMissed)}</span>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-between items-center">
          <button type="button" onClick={reset}
                  disabled={busy || !hasManual}
                  className="px-3 py-1.5 text-sm bg-white border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-30">
            自動集計に戻す
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
              キャンセル
            </button>
            <button type="button" onClick={save} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
