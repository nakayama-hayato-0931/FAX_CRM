import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const RESULTS = [
  { v: 'no_response',      l: '受電なし' },
  { v: 'response_inquiry', l: '問合せ' },
  { v: 'response_order',   l: '発注' },
  { v: 'refusal',          l: '拒否' },
  { v: 'invalid_number',   l: '番号無効' },
  { v: 'other',            l: 'その他' },
];

/**
 * 受電報告 手動入力モーダル (バッチ無しで1件保存)
 *   - 会社名検索で customer を選択
 *   - 送信日 / PC / 原稿 (任意) / 結果 / 詳細 / 受電日時 (任意) を入力
 *   - POST /api/incoming-calls
 */
export default function IncomingCallManualModal({ onClose, onCompleted, initial = {} }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [customer, setCustomer] = useState(initial.customer || null);

  const todayYMD = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    sendDate: initial.sendDate || todayYMD,
    pcNumber: initial.pcNumber || '',
    manuscriptDate: initial.manuscriptDate || '',
    manuscriptSlot: initial.manuscriptSlot || '',
    result: initial.result || 'no_response',
    resultDetail: '',
    respondedAt: '',
  });
  const [busy, setBusy] = useState(false);

  // 顧客検索 (q が 2文字以上で 300ms debounce)
  useEffect(() => {
    if (!query || query.length < 2) { setCandidates([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get('/api/customers', { params: { q: query, pageSize: 10 } });
        setCandidates(data.data || []);
      } catch (_e) { /* ignore */ }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const submit = async (e) => {
    e.preventDefault();
    if (!customer) { toast.error('顧客を選択してください'); return; }
    if (!form.sendDate || !form.pcNumber || !form.result) { toast.error('送信日 / PC / 結果 は必須'); return; }
    setBusy(true);
    try {
      const body = {
        customerId: customer.id,
        sendDate: form.sendDate,
        pcNumber: form.pcNumber,
        result: form.result,
        resultDetail: form.resultDetail || null,
        respondedAt: form.respondedAt || null,
        manuscriptDate: form.manuscriptDate || null,
        manuscriptSlot: form.manuscriptSlot ? Number(form.manuscriptSlot) : null,
      };
      await api.post('/api/incoming-calls', body);
      toast.success('受電報告を保存しました');
      onCompleted?.();
    } catch (err) {
      toast.error(err.userMessage || '保存失敗');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
            <h2 className="text-lg font-semibold text-zinc-900">受電報告 手動入力</h2>
            <button type="button" onClick={onClose} disabled={busy}
                    className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
          </div>

          <div className="p-6 space-y-4">
            {/* 顧客選択 */}
            <Field label="顧客 *" hint="会社名 / 電話番号 / FAX番号 で検索">
              {!customer ? (
                <>
                  <input type="text" value={query}
                         onChange={(e) => setQuery(e.target.value)}
                         placeholder="例: 株式会社○○"
                         className="rep-input"
                         autoFocus />
                  {searching && <div className="text-[11px] text-zinc-400 mt-1">検索中…</div>}
                  {candidates.length > 0 && (
                    <ul className="mt-1 border border-zinc-200 rounded max-h-48 overflow-auto bg-white shadow">
                      {candidates.map((c) => (
                        <li key={c.id}>
                          <button type="button"
                                  onClick={() => { setCustomer(c); setQuery(''); setCandidates([]); }}
                                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50">
                            <div className="font-medium">{c.company_name}</div>
                            <div className="text-xs text-zinc-500">
                              {c.fax_number ? `FAX: ${c.fax_number}` : ''}
                              {c.phone_number ? ` / 電話: ${c.phone_number}` : ''}
                              {c.prefecture ? ` / ${c.prefecture}` : ''}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded px-3 py-2">
                  <div>
                    <div className="font-medium">{customer.company_name}</div>
                    <div className="text-xs text-zinc-600">
                      {customer.fax_number ? `FAX: ${customer.fax_number}` : ''}
                      {customer.phone_number ? ` / 電話: ${customer.phone_number}` : ''}
                    </div>
                  </div>
                  <button type="button" onClick={() => setCustomer(null)}
                          className="text-xs text-indigo-700 hover:underline">変更</button>
                </div>
              )}
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="送信日 *">
                <input type="date" required value={form.sendDate}
                       onChange={(e) => setForm({ ...form, sendDate: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label="使用PC *">
                <input type="text" required value={form.pcNumber}
                       onChange={(e) => setForm({ ...form, pcNumber: e.target.value })}
                       placeholder="NO.3" className="rep-input font-mono" />
              </Field>
              <Field label="受電日時">
                <input type="datetime-local" value={form.respondedAt}
                       onChange={(e) => setForm({ ...form, respondedAt: e.target.value })}
                       className="rep-input" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="原稿日付 (任意)">
                <input type="date" value={form.manuscriptDate}
                       onChange={(e) => setForm({ ...form, manuscriptDate: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label="原稿スロット番号 (任意)">
                <input type="number" min="1" max="23" value={form.manuscriptSlot}
                       onChange={(e) => setForm({ ...form, manuscriptSlot: e.target.value })}
                       placeholder="1〜23" className="rep-input tabular-nums" />
              </Field>
            </div>

            <Field label="結果 *">
              <div className="flex gap-2 flex-wrap">
                {RESULTS.map((r) => (
                  <button key={r.v} type="button"
                          onClick={() => setForm({ ...form, result: r.v })}
                          className={[
                            'px-3 py-1.5 text-sm rounded border transition',
                            form.result === r.v
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50',
                          ].join(' ')}>
                    {r.l}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="詳細メモ">
              <textarea rows={3} value={form.resultDetail}
                        onChange={(e) => setForm({ ...form, resultDetail: e.target.value })}
                        placeholder="例: 見積依頼の電話あり、明日折り返し"
                        className="rep-input" />
            </Field>
          </div>

          <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
              キャンセル
            </button>
            <button type="submit" disabled={busy || !customer}
                    className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </form>

        <style jsx global>{`
          .rep-input { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 6px 10px; font-size: 13px; background: white; }
          .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700 mb-1">{label}</span>
      {hint && <span className="block text-[11px] text-zinc-500 mb-1.5">{hint}</span>}
      {children}
    </label>
  );
}
