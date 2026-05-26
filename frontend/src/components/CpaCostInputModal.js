import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * CPA コスト 月別 手動入力モーダル
 *   - 月の確定版コスト (in_house_cost) を upsert / 削除
 *   - 削除すると 概算 (送信数 × 単価) に戻る
 *
 * Props:
 *   - month: 'YYYY-MM-01'
 *   - monthLabel: '2026年5月'
 *   - row: 当該月の CPA row オブジェクト (sends, in_house_cost, in_house_cost_is_manual, outsourced_cost 等)
 *   - costPerFax: number  概算単価 (送信1通あたり 円)
 *   - onClose, onSaved
 */
export default function CpaCostInputModal({ month, monthLabel, row, costPerFax, onClose, onSaved }) {
  const initial = row?.in_house_cost_is_manual ? String(row.in_house_cost || 0) : '';
  const [value, setValue] = useState(initial);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // 既存メモを取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/cpa/monthly-cost/${month}`);
        if (!cancelled && data.data?.memo) setMemo(data.data.memo);
      } catch (_) { /* no-op */ }
    })();
    return () => { cancelled = true; };
  }, [month]);

  const sends = Number(row?.sends || 0);
  const inHouseSends = Number(row?.in_house_sends || 0);
  const estimated = Math.floor(inHouseSends * (costPerFax || 0));
  const outsourcedCost = Number(row?.outsourced_cost || 0);
  const inputNum = value === '' ? null : Number(String(value).replace(/[¥,\s]/g, ''));
  const effectiveInHouse = inputNum != null && Number.isFinite(inputNum) && inputNum >= 0
    ? Math.round(inputNum)
    : estimated;
  const total = effectiveInHouse + outsourcedCost;

  const save = async () => {
    const n = inputNum;
    if (n == null) { toast.error('金額を入力してください (削除して概算に戻す場合は「概算に戻す」)'); return; }
    if (!Number.isFinite(n) || n < 0) { toast.error('0以上の数値を入力してください'); return; }
    setBusy(true);
    try {
      await api.put(`/api/cpa/monthly-cost/${month}`, { in_house_cost: Math.round(n), memo });
      toast.success('確定版コストを保存しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '保存失敗'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm(`${monthLabel} の確定版コストを削除して 概算 (送信数 × 単価) に戻します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/cpa/monthly-cost/${month}`);
      toast.success('概算に戻しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '削除失敗'); }
    finally { setBusy(false); }
  };

  const yen = (v) => '¥' + Math.round(v).toLocaleString();

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold text-zinc-900">コスト確定値入力 — {monthLabel}</h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {/* 概算 */}
          <div className="bg-zinc-50 border border-zinc-200 rounded p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-zinc-500">自社送信数:</span><span className="tabular-nums">{inHouseSends.toLocaleString()} 通</span></div>
            <div className="flex justify-between"><span className="text-zinc-500">単価 (1通あたり):</span><span className="tabular-nums">¥{costPerFax}</span></div>
            <div className="flex justify-between border-t border-zinc-200 pt-1 mt-1">
              <span className="text-zinc-500">概算 (送信数 × 単価):</span>
              <span className="tabular-nums font-semibold">{yen(estimated)}</span>
            </div>
          </div>

          {/* 手動入力 */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">
              自社FAX 確定版コスト (空欄なら 概算 {yen(estimated)} が使われます)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">¥</span>
              <input type="text" inputMode="decimal" value={value}
                     onChange={(e) => setValue(e.target.value)}
                     placeholder={estimated.toLocaleString()}
                     disabled={busy}
                     className="flex-1 border border-zinc-300 rounded px-3 py-2 text-right tabular-nums" />
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">メモ (任意)</label>
            <input type="text" value={memo}
                   onChange={(e) => setMemo(e.target.value)}
                   disabled={busy}
                   placeholder="例: 5月確定請求書ベース"
                   className="w-full border border-zinc-300 rounded px-3 py-2 text-sm" />
          </div>

          {/* 合計プレビュー */}
          <div className="bg-indigo-50 border border-indigo-200 rounded p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-600">自社FAX (上記):</span>
              <span className="tabular-nums">{yen(effectiveInHouse)}
                <span className="ml-1 text-[10px] text-zinc-500">({inputNum != null ? '確定' : '概算'})</span>
              </span>
            </div>
            <div className="flex justify-between"><span className="text-zinc-600">外注費:</span><span className="tabular-nums">{yen(outsourcedCost)}</span></div>
            <div className="flex justify-between border-t border-indigo-200 pt-1 mt-1 font-semibold text-indigo-900">
              <span>合計コスト (CPA 表に反映):</span>
              <span className="tabular-nums">{yen(total)}</span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-between gap-2">
          <button type="button" onClick={reset}
                  disabled={busy || !row?.in_house_cost_is_manual}
                  className="px-3 py-1.5 text-sm bg-white border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-30">
            概算に戻す
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
              キャンセル
            </button>
            <button type="button" onClick={save} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
