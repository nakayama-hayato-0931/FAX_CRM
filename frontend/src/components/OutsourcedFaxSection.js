import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const DEMO_ROWS = [
  { id: 1, report_month: '2026-05-01', vendor_name: 'FAX委託A社', send_count: 12000, cost: 480000, memo: '通常便' },
  { id: 2, report_month: '2026-04-01', vendor_name: 'FAX委託A社', send_count: 10500, cost: 420000, memo: '' },
  { id: 3, report_month: '2026-03-01', vendor_name: 'FAX委託A社', send_count: 8000,  cost: 320000, memo: '初回月' },
];

const yen = (v) => '¥' + Number(v || 0).toLocaleString();
const num = (v) => Number(v || 0).toLocaleString();

function formatMonth(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function currentMonthInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function OutsourcedFaxSection({ isDemo, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);  // {report_month, ...} or null = 新規

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) { setLoading(false); setRows(DEMO_ROWS); return; }
      setLoading(true);
      try {
        const { data } = await api.get('/api/outsourced-fax');
        if (!cancelled) setRows(data.data || []);
      } catch (e) {
        if (!cancelled) toast.error(e.userMessage || '読み込み失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey]);

  const openNew = () => {
    setEditing({
      report_month: currentMonthInput(),
      vendor_name: '',
      send_count: '',
      cost: '',
      memo: '',
    });
    setShowForm(true);
  };

  const openEdit = (row) => {
    setEditing({
      report_month: (row.report_month || '').slice(0, 7),  // 'YYYY-MM-01' → 'YYYY-MM'
      vendor_name: row.vendor_name || '',
      send_count: row.send_count,
      cost: row.cost,
      memo: row.memo || '',
    });
    setShowForm(true);
  };

  const save = async () => {
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); setShowForm(false); return; }
    if (!editing.report_month) { toast.error('対象月は必須'); return; }
    try {
      await api.post('/api/outsourced-fax', {
        report_month: editing.report_month,
        vendor_name: editing.vendor_name || null,
        send_count: Number(editing.send_count) || 0,
        cost: Number(editing.cost) || 0,
        memo: editing.memo || null,
      });
      toast.success('委託送信を保存しました');
      setShowForm(false);
      setEditing(null);
      setReloadKey((k) => k + 1);
      onChanged && onChanged();
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    }
  };

  const remove = async (row) => {
    if (isDemo) { toast('デモ表示中は削除されません', { icon: 'ℹ' }); return; }
    if (!confirm(`${formatMonth(row.report_month)} の委託レコードを削除しますか?`)) return;
    try {
      await api.delete(`/api/outsourced-fax/${row.report_month.slice(0, 7)}`);
      toast.success('削除しました');
      setReloadKey((k) => k + 1);
      onChanged && onChanged();
    } catch (e) {
      toast.error(e.userMessage || '削除失敗');
    }
  };

  const totals = rows.reduce((acc, r) => {
    acc.send_count += Number(r.send_count) || 0;
    acc.cost += Number(r.cost) || 0;
    return acc;
  }, { send_count: 0, cost: 0 });

  return (
    <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mt-8">
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">委託(外注)FAX送信 — 月別実績</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            自社FAX以外の委託送信分のコストと送信数を月単位で記録。CPA表の「コスト」「送信数」に自動加算されます。
          </p>
        </div>
        <button onClick={openNew}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
          + 新規追加
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-600 uppercase">
            <tr>
              <th className="text-left px-4 py-2">対象月</th>
              <th className="text-left px-4 py-2">委託先</th>
              <th className="text-right px-4 py-2">送信数</th>
              <th className="text-right px-4 py-2">コスト</th>
              <th className="text-left px-4 py-2">メモ</th>
              <th className="text-right px-4 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-400">読み込み中…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-400">
                委託送信データがありません。「+ 新規追加」から入力してください。
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                <td className="px-4 py-2">{formatMonth(r.report_month)}</td>
                <td className="px-4 py-2 text-zinc-700">{r.vendor_name || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{num(r.send_count)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{yen(r.cost)}</td>
                <td className="px-4 py-2 text-xs text-zinc-600 max-w-[200px] truncate">{r.memo || '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => openEdit(r)} className="text-xs text-indigo-600 hover:underline mr-2">編集</button>
                  <button onClick={() => remove(r)} className="text-xs text-red-600 hover:underline">削除</button>
                </td>
              </tr>
            ))}
            {!loading && rows.length > 0 && (
              <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                <td className="px-4 py-2" colSpan={2}>合計({rows.length} ヶ月)</td>
                <td className="px-4 py-2 text-right tabular-nums">{num(totals.send_count)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{yen(totals.cost)}</td>
                <td colSpan={2}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 入力フォーム(モーダル) */}
      {showForm && editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-zinc-900 mb-4">委託送信の入力</h2>
            <div className="space-y-3 text-sm">
              <Field label="対象月" required>
                <input type="month" value={editing.report_month}
                       onChange={(e) => setEditing({ ...editing, report_month: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label="委託先(任意)">
                <input type="text" value={editing.vendor_name}
                       onChange={(e) => setEditing({ ...editing, vendor_name: e.target.value })}
                       className="rep-input" placeholder="例: FAX委託A社" />
              </Field>
              <Field label="送信数" required>
                <input type="number" min="0" value={editing.send_count}
                       onChange={(e) => setEditing({ ...editing, send_count: e.target.value })}
                       className="rep-input tabular-nums" placeholder="例: 10000" />
              </Field>
              <Field label="コスト(円)" required>
                <input type="number" min="0" value={editing.cost}
                       onChange={(e) => setEditing({ ...editing, cost: e.target.value })}
                       className="rep-input tabular-nums" placeholder="例: 500000" />
              </Field>
              <Field label="メモ">
                <textarea value={editing.memo}
                          onChange={(e) => setEditing({ ...editing, memo: e.target.value })}
                          className="rep-input" rows={2} />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)}
                      className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md">キャンセル</button>
              <button onClick={save}
                      className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .rep-input {
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          background: white;
        }
        .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
