import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * CPA コスト 月別 手動入力モーダル
 *   - 自社FAX 確定版コスト (in_house_cost) の upsert / 削除
 *   - 外注費 (outsourced_fax_records: send_count, cost, vendor_name, memo) の upsert / 削除
 *   - 自社FAX を削除すると 概算 (送信数 × 単価) に戻る
 *
 * Props:
 *   - month: 'YYYY-MM-01'
 *   - monthLabel: '2026年5月'
 *   - row: 当該月の CPA row オブジェクト (sends, in_house_cost, in_house_cost_is_manual,
 *          outsourced_cost, outsourced_sends 等)
 *   - costPerFax: number  概算単価 (送信1通あたり 円)
 *   - onClose, onSaved
 */
export default function CpaCostInputModal({ month, monthLabel, row, costPerFax, onClose, onSaved }) {
  // 自社FAX 確定値
  const initialInHouse = row?.in_house_cost_is_manual ? String(row.in_house_cost || 0) : '';
  const [inHouseValue, setInHouseValue] = useState(initialInHouse);
  const [memo, setMemo] = useState('');

  // 外注費
  const initialOutsourcedCost  = Number(row?.outsourced_cost  || 0);
  const initialOutsourcedSends = Number(row?.outsourced_sends || 0);
  const [outsourcedCostValue, setOutsourcedCostValue] = useState(
    initialOutsourcedCost > 0 ? String(initialOutsourcedCost) : ''
  );
  const [outsourcedSendsValue, setOutsourcedSendsValue] = useState(
    initialOutsourcedSends > 0 ? String(initialOutsourcedSends) : ''
  );
  const [outsourcedVendor, setOutsourcedVendor] = useState('');
  const [outsourcedMemo, setOutsourcedMemo] = useState('');
  const [outsourcedExists, setOutsourcedExists] = useState(false);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // 既存メモ + 外注費の現在値を取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [mc, of] = await Promise.all([
          api.get(`/api/cpa/monthly-cost/${month}`).catch(() => ({ data: { data: null } })),
          api.get(`/api/outsourced-fax/${month}`).catch(() => ({ data: { data: null } })),
        ]);
        if (cancelled) return;
        if (mc.data.data?.memo) setMemo(mc.data.data.memo);
        const o = of.data.data;
        if (o) {
          setOutsourcedExists(true);
          setOutsourcedCostValue(o.cost ? String(o.cost) : '');
          setOutsourcedSendsValue(o.send_count ? String(o.send_count) : '');
          setOutsourcedVendor(o.vendor_name || '');
          setOutsourcedMemo(o.memo || '');
        }
      } catch (_) { /* no-op */ }
    })();
    return () => { cancelled = true; };
  }, [month]);

  const sends = Number(row?.sends || 0);
  const inHouseSends = Number(row?.in_house_sends || 0);
  const estimated = Math.floor(inHouseSends * (costPerFax || 0));
  const parseNum = (v) => v === '' ? null : Number(String(v).replace(/[¥,\s]/g, ''));
  const inHouseInputNum = parseNum(inHouseValue);
  const effectiveInHouse = inHouseInputNum != null && Number.isFinite(inHouseInputNum) && inHouseInputNum >= 0
    ? Math.round(inHouseInputNum)
    : estimated;
  const outsourcedInputNum = parseNum(outsourcedCostValue);
  const effectiveOutsourced = outsourcedInputNum != null && Number.isFinite(outsourcedInputNum) && outsourcedInputNum >= 0
    ? Math.round(outsourcedInputNum)
    : initialOutsourcedCost;
  const total = effectiveInHouse + effectiveOutsourced;

  // ---- 自社FAX 操作 ----
  const saveInHouse = async () => {
    const n = inHouseInputNum;
    if (n == null) {
      toast.error('自社FAX 確定コストを入力してください (削除して概算に戻す場合は「概算に戻す」)');
      return;
    }
    if (!Number.isFinite(n) || n < 0) { toast.error('0以上の数値を入力してください'); return; }
    setBusy(true);
    try {
      await api.put(`/api/cpa/monthly-cost/${month}`, { in_house_cost: Math.round(n), memo });
      toast.success('自社FAX 確定値を保存しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '保存失敗'); }
    finally { setBusy(false); }
  };

  const resetInHouse = async () => {
    if (!window.confirm(`${monthLabel} の自社FAX 確定値を削除して 概算 (送信数 × 単価) に戻します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/cpa/monthly-cost/${month}`);
      toast.success('自社FAX を概算に戻しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '削除失敗'); }
    finally { setBusy(false); }
  };

  // ---- 外注費 操作 ----
  const saveOutsourced = async () => {
    const c = outsourcedInputNum;
    const s = parseNum(outsourcedSendsValue);
    if (c == null && s == null && !outsourcedVendor.trim() && !outsourcedMemo.trim()) {
      toast.error('外注費 のコストまたは送信数を入力してください');
      return;
    }
    if (c != null && (!Number.isFinite(c) || c < 0)) { toast.error('コストは 0以上の数値'); return; }
    if (s != null && (!Number.isFinite(s) || s < 0)) { toast.error('送信数は 0以上の数値'); return; }
    setBusy(true);
    try {
      await api.post('/api/outsourced-fax', {
        report_month: month,
        cost: c ?? 0,
        send_count: s ?? 0,
        vendor_name: outsourcedVendor || null,
        memo: outsourcedMemo || null,
      });
      toast.success('外注費を保存しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '外注費の保存失敗'); }
    finally { setBusy(false); }
  };

  const removeOutsourced = async () => {
    if (!window.confirm(`${monthLabel} の外注費レコードを削除します。よろしいですか？`)) return;
    setBusy(true);
    try {
      await api.delete(`/api/outsourced-fax/${month}`);
      toast.success('外注費を削除しました');
      onSaved?.();
      onClose();
    } catch (e) { toast.error(e.userMessage || '削除失敗'); }
    finally { setBusy(false); }
  };

  const yen = (v) => '¥' + Math.round(v).toLocaleString();

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-zinc-900">コスト入力 — {monthLabel}</h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5 text-sm overflow-auto flex-1">
          {/* === 自社FAX セクション === */}
          <section className="border border-zinc-200 rounded-lg p-3 bg-zinc-50/40">
            <h3 className="text-xs font-semibold text-zinc-700 mb-2">① 自社FAX</h3>
            <div className="bg-white border border-zinc-200 rounded p-2.5 text-xs space-y-1 mb-2">
              <div className="flex justify-between"><span className="text-zinc-500">自社送信数:</span><span className="tabular-nums">{inHouseSends.toLocaleString()} 通</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">単価 (1通あたり):</span><span className="tabular-nums">¥{costPerFax}</span></div>
              <div className="flex justify-between border-t border-zinc-100 pt-1 mt-1">
                <span className="text-zinc-500">概算 (送信数 × 単価):</span>
                <span className="tabular-nums font-semibold">{yen(estimated)}</span>
              </div>
            </div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">
              確定値 (空欄なら 概算 {yen(estimated)} が使われます)
            </label>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-zinc-500">¥</span>
              <input type="text" inputMode="decimal" value={inHouseValue}
                     onChange={(e) => setInHouseValue(e.target.value)}
                     placeholder={estimated.toLocaleString()}
                     disabled={busy}
                     className="flex-1 border border-zinc-300 rounded px-3 py-2 text-right tabular-nums" />
            </div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">メモ (任意)</label>
            <input type="text" value={memo}
                   onChange={(e) => setMemo(e.target.value)}
                   disabled={busy}
                   placeholder="例: 5月確定請求書ベース"
                   className="w-full border border-zinc-300 rounded px-3 py-2 text-sm mb-2" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={resetInHouse}
                      disabled={busy || !row?.in_house_cost_is_manual}
                      className="px-3 py-1 text-xs bg-white border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-30">
                概算に戻す
              </button>
              <button type="button" onClick={saveInHouse} disabled={busy}
                      className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                自社FAX を保存
              </button>
            </div>
          </section>

          {/* === 外注費 セクション === */}
          <section className="border border-zinc-200 rounded-lg p-3 bg-amber-50/40">
            <h3 className="text-xs font-semibold text-zinc-700 mb-2">② 外注費 (委託FAX)</h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">コスト (円)</label>
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 text-xs">¥</span>
                  <input type="text" inputMode="decimal" value={outsourcedCostValue}
                         onChange={(e) => setOutsourcedCostValue(e.target.value)}
                         placeholder="0"
                         disabled={busy}
                         className="flex-1 border border-zinc-300 rounded px-2 py-2 text-right tabular-nums text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">送信数 (通)</label>
                <input type="text" inputMode="numeric" value={outsourcedSendsValue}
                       onChange={(e) => setOutsourcedSendsValue(e.target.value)}
                       placeholder="0"
                       disabled={busy}
                       className="w-full border border-zinc-300 rounded px-2 py-2 text-right tabular-nums text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">委託先 (任意)</label>
                <input type="text" value={outsourcedVendor}
                       onChange={(e) => setOutsourcedVendor(e.target.value)}
                       disabled={busy}
                       placeholder="例: ○○FAXサービス"
                       className="w-full border border-zinc-300 rounded px-2 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">メモ (任意)</label>
                <input type="text" value={outsourcedMemo}
                       onChange={(e) => setOutsourcedMemo(e.target.value)}
                       disabled={busy}
                       className="w-full border border-zinc-300 rounded px-2 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={removeOutsourced}
                      disabled={busy || !outsourcedExists}
                      className="px-3 py-1 text-xs bg-white border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-30">
                外注費を削除
              </button>
              <button type="button" onClick={saveOutsourced} disabled={busy}
                      className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50">
                外注費を保存
              </button>
            </div>
          </section>

          {/* === 合計プレビュー === */}
          <section className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-600">自社FAX:</span>
              <span className="tabular-nums">{yen(effectiveInHouse)}
                <span className="ml-1 text-[10px] text-zinc-500">({inHouseInputNum != null ? '確定' : '概算'})</span>
              </span>
            </div>
            <div className="flex justify-between"><span className="text-zinc-600">外注費:</span><span className="tabular-nums">{yen(effectiveOutsourced)}</span></div>
            <div className="flex justify-between border-t border-emerald-200 pt-1 mt-1 font-semibold text-emerald-900">
              <span>合計コスト (CPA 表に反映):</span>
              <span className="tabular-nums">{yen(total)}</span>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1">
              ※ 「保存」 ボタンは セクションごと に押してください。 合計プレビューは 入力中の値での 想定 を表示します。
            </p>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end">
          <button type="button" onClick={onClose} disabled={busy}
                  className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
