import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const RESULTS = [
  { v: 'project',       l: '案件化' },
  { v: 'ng',            l: 'NG' },
  { v: 'recall',        l: 'リコール' },
  { v: 'material_sent', l: '資料送付' },
  { v: 'other',         l: 'その他' },
];

const RESULT_BADGE = {
  project:          { label: '案件化',   cls: 'bg-emerald-100 text-emerald-800' },
  ng:               { label: 'NG',       cls: 'bg-red-100 text-red-700' },
  recall:           { label: 'リコール', cls: 'bg-sky-100 text-sky-700' },
  material_sent:    { label: '資料送付', cls: 'bg-amber-100 text-amber-800' },
  other:            { label: 'その他',   cls: 'bg-zinc-100 text-zinc-700' },
  no_response:      { label: '受電なし', cls: 'bg-zinc-100 text-zinc-500' },
  response_inquiry: { label: '問合せ',   cls: 'bg-amber-100 text-amber-800' },
  response_order:   { label: '発注',     cls: 'bg-emerald-100 text-emerald-800' },
  refusal:          { label: '拒否',     cls: 'bg-red-100 text-red-700' },
  invalid_number:   { label: '番号無効', cls: 'bg-zinc-100 text-zinc-500' },
};
const CHANNEL_LABEL = {
  fax: 'FAX', call: 'CALL', email: 'EMAIL', sns: 'SNS', meeting: '面談', other: 'その他',
};

// 使用PC: NO.01 〜 NO.23 の選択肢
const PC_OPTIONS = Array.from({ length: 23 }, (_, i) => `NO.${String(i + 1).padStart(2, '0')}`);

// 'NO.3' / 'NO.03' / '3' / '03' / 'NO. 3' を全部 'NO.03' に揃える (既存データ吸収)
function normalizePcNumber(v) {
  if (v == null || v === '') return '';
  const m = String(v).match(/(\d{1,2})/);
  if (!m) return '';
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 23) return '';
  return `NO.${String(n).padStart(2, '0')}`;
}

// 全角数字 → 半角 + 全角ハイフン類 → 半角 + 数字/ハイフン/+ 以外を除去
function normalizeDigit(s) {
  if (!s) return '';
  return String(s)
    .replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[‐‑‒–—―−ー－]/g, '-')
    .replace(/[+]/g, '+')
    .replace(/[^0-9+\-]/g, '');
}

/**
 * 受電報告 手動入力モーダル (バッチ無しで1件保存)
 *
 * 設計:
 *   - 顧客: 「会社名 / 電話 / FAX」 を 常時直接入力可能。
 *     入力中に サジェスト (既存顧客検索) を表示し、 選択すると 3 フィールドを自動入力 +
 *     customer.id を内部に保持。 直接入力のまま送信すれば quick-create で新規確保。
 *   - 原稿: 「履歴書 登録番号」 入力中に サジェスト (manuscript_contents 検索) を表示し、
 *     選択すると 登録番号を自動入力。 タイトル / 国籍 / 業種 を補助表示。 直接入力可。
 */
export default function IncomingCallManualModal({ onClose, onCompleted, initial = {} }) {
  // 顧客入力 (直接入力 + サジェスト統合)
  const [companyInput, setCompanyInput] = useState(initial.customer?.company_name || '');
  const [phoneInput, setPhoneInput]     = useState(initial.customer?.phone_number || '');
  const [faxInput, setFaxInput]         = useState(initial.customer?.fax_number || '');
  // 既存顧客と紐付いている場合の customer object (null なら直接入力 → 送信時 quick-create)
  const [customer, setCustomer] = useState(initial.customer || null);
  // 顧客サジェスト
  const [custCandidates, setCustCandidates] = useState([]);
  const [custSearching, setCustSearching] = useState(false);
  const [custFocus, setCustFocus] = useState(null);  // 'company' | 'phone' | 'fax' | null
  // 選択した顧客の詳細 + タイムライン
  const [customerDetail, setCustomerDetail] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  // 今 を datetime-local 形式 (YYYY-MM-DDTHH:mm) で初期化
  const nowLocal = (() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [form, setForm] = useState({
    sendDate: initial.sendDate || '',
    pcNumber: normalizePcNumber(initial.pcNumber || ''),
    candidateRegistrationNo: initial.candidateRegistrationNo || '',
    salesOwner: initial.salesOwner || '',
    result: initial.result || 'project',
    resultDetail: '',
    respondedAt: initial.respondedAt || nowLocal,
  });
  const [busy, setBusy] = useState(false);

  // 原稿サジェスト
  const [mscCandidates, setMscCandidates] = useState([]);
  const [mscSearching, setMscSearching] = useState(false);
  const [mscFocused, setMscFocused] = useState(false);
  const [selectedManuscript, setSelectedManuscript] = useState(null);

  // 担当営業 マスタ (トグル選択肢)
  const [salesOwners, setSalesOwners] = useState([]);
  const [showNewOwner, setShowNewOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState('');
  const [addingOwner, setAddingOwner] = useState(false);

  const loadSalesOwners = async () => {
    try {
      const { data } = await api.get('/api/sales-owners');
      setSalesOwners(data.data || []);
    } catch (_e) { /* ignore */ }
  };
  useEffect(() => { loadSalesOwners(); }, []);

  const addSalesOwner = async () => {
    const n = newOwnerName.trim();
    if (!n) { toast.error('担当営業名を入力してください'); return; }
    setAddingOwner(true);
    try {
      const { data } = await api.post('/api/sales-owners', { name: n });
      await loadSalesOwners();
      setForm((f) => ({ ...f, salesOwner: data.data?.name || n }));
      setNewOwnerName('');
      setShowNewOwner(false);
      toast.success(`担当営業 「${n}」 を追加しました`);
    } catch (e) {
      toast.error(e.userMessage || '追加失敗');
    } finally {
      setAddingOwner(false);
    }
  };

  // 顧客サジェスト検索 (会社名/電話/FAX のうち focus 中フィールドの値で 2文字以上 + debounce)
  const debounceRef = useRef(null);
  useEffect(() => {
    if (customer) { setCustCandidates([]); return; }   // 既存と紐付け済ならサジェストしない
    const q = custFocus === 'company' ? companyInput
            : custFocus === 'phone'   ? phoneInput
            : custFocus === 'fax'     ? faxInput : '';
    if (!q || q.length < 2) { setCustCandidates([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setCustSearching(true);
      try {
        const { data } = await api.get('/api/customers', { params: { q, pageSize: 8 } });
        setCustCandidates(data.data || []);
      } catch (_e) { /* ignore */ }
      finally { setCustSearching(false); }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [companyInput, phoneInput, faxInput, custFocus, customer]);

  // 顧客選択:
  //   入力フィールドを 候補から自動入力 + customer ID を内部保持。
  //   送信日 / 使用PC / 原稿(登録番号) / 担当営業 を 顧客の最新情報から補完。
  //   詳細 + タイムラインを別領域に表示。
  const selectCustomer = (c) => {
    setCustomer(c);
    setCompanyInput(c.company_name || '');
    setPhoneInput(c.phone_number || '');
    setFaxInput(c.fax_number || '');
    setCustCandidates([]);
    setCustFocus(null);
    setForm((f) => ({
      ...f,
      sendDate: c.last_sent_at ? new Date(c.last_sent_at).toISOString().slice(0, 10) : f.sendDate,
      pcNumber: normalizePcNumber(c.last_pc_number) || f.pcNumber,
    }));
    api.get('/api/incoming-calls/last', { params: { customer_id: c.id } })
      .then((r) => {
        const last = r.data?.data;
        if (!last) return;
        setForm((f) => ({
          ...f,
          candidateRegistrationNo: last.candidate_registration_no || f.candidateRegistrationNo,
          salesOwner: f.salesOwner || last.sales_owner || '',
        }));
      })
      .catch(() => { /* ignore */ });
    setLoadingDetail(true);
    setCustomerDetail(null);
    setTimeline([]);
    setTimelineExpanded(false);
    Promise.all([
      api.get(`/api/customers/${c.id}`).catch(() => ({ data: { data: null } })),
      api.get(`/api/customers/${c.id}/timeline`, { params: { limit: 50 } }).catch(() => ({ data: { data: [] } })),
    ]).then(([d, t]) => {
      setCustomerDetail(d.data?.data || null);
      setTimeline(t.data?.data || []);
    }).finally(() => setLoadingDetail(false));
  };

  // 顧客の紐付け解除 (= 直接入力に戻る)
  const clearCustomer = () => {
    setCustomer(null);
    setCustomerDetail(null);
    setTimeline([]);
    setTimelineExpanded(false);
  };

  // 原稿サジェスト検索 (登録番号 or タイトル で 1文字以上 + debounce)
  const mscDebounceRef = useRef(null);
  useEffect(() => {
    const q = form.candidateRegistrationNo;
    if (selectedManuscript && selectedManuscript.registration_no === q) {
      // 既に選択済の候補と同値なら何もしない
      return;
    }
    if (!q || q.length < 1) { setMscCandidates([]); return; }
    clearTimeout(mscDebounceRef.current);
    mscDebounceRef.current = setTimeout(async () => {
      setMscSearching(true);
      try {
        const { data } = await api.get('/api/manuscript-contents', { params: { q, pageSize: 8 } });
        setMscCandidates(data.data || []);
      } catch (_e) { /* ignore */ }
      finally { setMscSearching(false); }
    }, 300);
    return () => clearTimeout(mscDebounceRef.current);
  }, [form.candidateRegistrationNo, selectedManuscript]);

  const selectManuscript = (m) => {
    setSelectedManuscript(m);
    setForm((f) => ({ ...f, candidateRegistrationNo: m.registration_no || f.candidateRegistrationNo }));
    setMscCandidates([]);
    setMscFocused(false);
  };

  // 電話 / FAX の onChange: 全角数字を即座に半角に変換、 全角入力を弾く
  const onDigitChange = (key, raw) => {
    const normalized = normalizeDigit(raw);
    if (normalized !== raw && /[^\x00-\x7F]/.test(raw)) {
      toast('全角は半角に自動変換しました', { duration: 1500 });
    }
    if (key === 'phone') setPhoneInput(normalized);
    else if (key === 'fax') setFaxInput(normalized);
    // 直接入力 中は customer 紐付けを解除
    if (customer) clearCustomer();
  };

  const onCompanyChange = (v) => {
    setCompanyInput(v);
    if (customer) clearCustomer();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.respondedAt) { toast.error('受電日時 は必須'); return; }
    if (!form.salesOwner || !form.salesOwner.trim()) { toast.error('担当営業 は必須'); return; }
    if (!form.result)      { toast.error('結果 は必須'); return; }

    let customerId = customer?.id;

    // 既存顧客と紐付いてなければ quick-create
    if (!customerId) {
      const c = companyInput.trim();
      const f = faxInput;
      const p = phoneInput;
      if (!c && !f && !p) { toast.error('会社名 / 電話 / FAX のいずれかを入力してください'); return; }
      setBusy(true);
      try {
        const { data } = await api.post('/api/customers/quick-create', {
          company_name: c || null,
          fax_number: f || null,
          phone_number: p || null,
        });
        customerId = data.data?.id;
        if (!customerId) throw new Error('顧客の確保に失敗しました');
      } catch (err) {
        toast.error(err.userMessage || '顧客作成失敗');
        setBusy(false);
        return;
      }
    }

    setBusy(true);
    try {
      const body = {
        customerId,
        sendDate: form.sendDate || null,
        pcNumber: form.pcNumber || null,
        candidateRegistrationNo: form.candidateRegistrationNo || null,
        salesOwner: form.salesOwner || null,
        result: form.result,
        resultDetail: form.resultDetail || null,
        respondedAt: form.respondedAt || null,
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

  const showCustSuggest = !customer && custCandidates.length > 0 && custFocus;
  const showMscSuggest  = !selectedManuscript && mscFocused && mscCandidates.length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
            <h2 className="text-lg font-semibold text-zinc-900">受電報告 手動入力</h2>
            <button type="button" onClick={onClose} disabled={busy}
                    className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
          </div>

          <div className="p-6 space-y-4 overflow-auto flex-1">
            {/* 顧客 — 直接入力 + サジェスト */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-zinc-700">顧客 *</span>
                {customer && (
                  <span className="text-[11px] text-emerald-700">
                    既存顧客と紐付け中
                    <button type="button" onClick={clearCustomer}
                            className="ml-2 text-zinc-500 hover:text-zinc-700 underline">解除</button>
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 mb-2">
                会社名 / 電話 / FAX を直接入力。 2文字以上で既存顧客のサジェストが出ます。 候補を選ぶと全項目が自動入力されます。
              </div>

              <div className="grid grid-cols-3 gap-2 relative">
                <div className="relative">
                  <input type="text" value={companyInput}
                         onChange={(e) => onCompanyChange(e.target.value)}
                         onFocus={() => setCustFocus('company')}
                         onBlur={() => setTimeout(() => setCustFocus((f) => f === 'company' ? null : f), 200)}
                         placeholder="会社名"
                         autoFocus
                         className="rep-input" />
                </div>
                <div className="relative">
                  <input type="tel" value={phoneInput}
                         onChange={(e) => onDigitChange('phone', e.target.value)}
                         onFocus={() => setCustFocus('phone')}
                         onBlur={() => setTimeout(() => setCustFocus((f) => f === 'phone' ? null : f), 200)}
                         inputMode="numeric"
                         placeholder="電話番号"
                         className="rep-input font-mono" />
                </div>
                <div className="relative">
                  <input type="tel" value={faxInput}
                         onChange={(e) => onDigitChange('fax', e.target.value)}
                         onFocus={() => setCustFocus('fax')}
                         onBlur={() => setTimeout(() => setCustFocus((f) => f === 'fax' ? null : f), 200)}
                         inputMode="numeric"
                         placeholder="FAX番号"
                         className="rep-input font-mono" />
                </div>

                {/* サジェスト ドロップダウン */}
                {showCustSuggest && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-zinc-200 rounded bg-white shadow-lg z-10 max-h-60 overflow-auto">
                    {custSearching && <div className="text-[11px] text-zinc-400 px-3 py-1">検索中…</div>}
                    {custCandidates.map((c) => (
                      <button key={c.id} type="button"
                              onMouseDown={(e) => e.preventDefault()}  // blur 抑止
                              onClick={() => selectCustomer(c)}
                              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-emerald-50">
                        <div className="font-medium">{c.company_name}</div>
                        <div className="text-xs text-zinc-500">
                          {c.fax_number   && <>FAX: {c.fax_number} </>}
                          {c.phone_number && <>/ 電話: {c.phone_number} </>}
                          {c.prefecture   && <>/ {c.prefecture}</>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 既存と紐付き済 → 詳細パネル */}
              {customer && (
                <div className="mt-3">
                  <SelectedCustomerPanel
                    customer={customer}
                    detail={customerDetail}
                    timeline={timeline}
                    timelineExpanded={timelineExpanded}
                    onToggleTimeline={() => setTimelineExpanded((v) => !v)}
                    loading={loadingDetail} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="受電日時 *">
                <input type="datetime-local" required value={form.respondedAt}
                       onChange={(e) => setForm({ ...form, respondedAt: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label={`送信日${customer ? ' (自動入力)' : ' (任意)'}`}
                     hint={customer ? '顧客の最終送信から補完 (変更可)' : '不明なら空欄でOK'}>
                <input type="date" value={form.sendDate}
                       onChange={(e) => setForm({ ...form, sendDate: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label={`使用PC${customer ? ' (自動入力)' : ' (任意)'}`}
                     hint={customer ? '顧客の最終PCから補完 (変更可)' : '不明なら空欄でOK'}>
                <select value={form.pcNumber}
                        onChange={(e) => setForm({ ...form, pcNumber: e.target.value })}
                        className="rep-input font-mono">
                  <option value="">指定なし</option>
                  {PC_OPTIONS.map((pc) => (
                    <option key={pc} value={pc}>{pc}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* 原稿 (登録番号) - サジェスト autocomplete */}
            <Field label="原稿 (履歴書 登録番号)"
                   hint="例: QT4654 / CZ5995 等。 入力中に原稿管理から候補が出ます。 直接入力もOK">
              <div className="relative">
                <input type="text" value={form.candidateRegistrationNo}
                       onChange={(e) => {
                         setForm({ ...form, candidateRegistrationNo: e.target.value });
                         if (selectedManuscript) setSelectedManuscript(null);
                       }}
                       onFocus={() => setMscFocused(true)}
                       onBlur={() => setTimeout(() => setMscFocused(false), 200)}
                       placeholder="QT4654 等"
                       className="rep-input font-mono" />
                {showMscSuggest && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-zinc-200 rounded bg-white shadow-lg z-10 max-h-60 overflow-auto">
                    {mscSearching && <div className="text-[11px] text-zinc-400 px-3 py-1">検索中…</div>}
                    {mscCandidates.map((m) => (
                      <button key={m.id} type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectManuscript(m)}
                              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-emerald-50">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-emerald-700 font-medium">{m.registration_no || '—'}</span>
                          <span className="text-zinc-800 truncate">{m.title || '—'}</span>
                        </div>
                        <div className="text-[10px] text-zinc-500 mt-0.5">
                          {m.nationality       && <>{m.nationality} </>}
                          {m.gender            && <>/ {m.gender} </>}
                          {m.industry_category && <>/ {m.industry_category}</>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedManuscript && (
                <div className="mt-1 text-[11px] text-zinc-600">
                  原稿: <span className="font-medium text-zinc-800">{selectedManuscript.title || '(無題)'}</span>
                  {selectedManuscript.nationality && <span className="ml-2 text-zinc-500">{selectedManuscript.nationality}</span>}
                </div>
              )}
            </Field>

            <Field label="担当営業 *" hint="応対した営業担当者を選択。 無ければ + 新規追加">
              <div className="flex gap-1.5 flex-wrap items-center">
                {salesOwners.map((o) => {
                  const selected = form.salesOwner === o.name;
                  return (
                    <button key={o.id} type="button"
                            onClick={() => setForm({ ...form, salesOwner: o.name })}
                            className={[
                              'px-3 py-1.5 text-sm rounded border transition',
                              selected
                                ? 'bg-emerald-600 text-white border-emerald-600 font-medium'
                                : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50',
                            ].join(' ')}>
                      {o.name}
                    </button>
                  );
                })}
                {form.salesOwner && !salesOwners.some((o) => o.name === form.salesOwner) && (
                  <button type="button"
                          className="px-3 py-1.5 text-sm rounded border bg-emerald-600 text-white border-emerald-600 font-medium">
                    {form.salesOwner}
                  </button>
                )}
                {!showNewOwner ? (
                  <button type="button"
                          onClick={() => setShowNewOwner(true)}
                          className="px-3 py-1.5 text-sm rounded border border-dashed border-zinc-400 text-zinc-600 hover:bg-zinc-50">
                    + 新規追加
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <input type="text" value={newOwnerName}
                           onChange={(e) => setNewOwnerName(e.target.value)}
                           onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSalesOwner(); } }}
                           placeholder="名前を入力"
                           autoFocus disabled={addingOwner}
                           className="border border-zinc-300 rounded px-2 py-1.5 text-sm w-32" />
                    <button type="button" onClick={addSalesOwner} disabled={addingOwner}
                            className="px-2 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                      追加
                    </button>
                    <button type="button" onClick={() => { setShowNewOwner(false); setNewOwnerName(''); }}
                            disabled={addingOwner}
                            className="px-2 py-1.5 text-sm bg-white border border-zinc-300 rounded text-zinc-500">
                      取消
                    </button>
                  </span>
                )}
              </div>
              {form.salesOwner && (
                <div className="text-[11px] text-zinc-500 mt-1">選択中: <span className="font-medium text-zinc-700">{form.salesOwner}</span></div>
              )}
            </Field>

            <Field label="結果 *">
              <div className="flex gap-2 flex-wrap">
                {RESULTS.map((r) => (
                  <button key={r.v} type="button"
                          onClick={() => setForm({ ...form, result: r.v })}
                          className={[
                            'px-3 py-1.5 text-sm rounded border transition',
                            form.result === r.v
                              ? 'bg-emerald-600 text-white border-emerald-600'
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

          <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
              キャンセル
            </button>
            <button type="submit"
                    disabled={busy
                              || !form.salesOwner || !form.salesOwner.trim()
                              || (!customer && !companyInput.trim() && !phoneInput && !faxInput)}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
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

function fmtDate(v)     { if (!v) return '—'; try { return new Date(v).toLocaleDateString('ja-JP'); } catch (_) { return String(v).slice(0, 10); } }
function fmtDateTime(v) { if (!v) return '—'; try { return new Date(v).toLocaleString('ja-JP', { hour12: false }); } catch (_) { return String(v); } }

function SelectedCustomerPanel({ customer, detail, timeline, timelineExpanded, onToggleTimeline, loading }) {
  const d = detail || customer;
  const isBL = !!d.is_blacklisted;
  const sendCount = Number(d.send_count || 0);
  const responseCount = Number(d.response_count || 0);
  const callCount = (timeline || []).filter((e) => e.channel === 'call').length;

  return (
    <div className="bg-emerald-50/60 border border-emerald-200 rounded">
      <div className="flex items-start justify-between px-3 py-2 border-b border-emerald-100">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-zinc-900 truncate">{d.company_name}</div>
          <div className="text-xs text-zinc-600 mt-0.5">
            {d.fax_number   && <>FAX: <span className="font-mono">{d.fax_number}</span>{' '}</>}
            {d.phone_number && <>/ 電話: <span className="font-mono">{d.phone_number}</span></>}
          </div>
        </div>
        {isBL && (
          <span className="ml-2 flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700 font-medium"
                title={d.blacklisted_reason || ''}>
            ブラック ({d.blacklisted_reason || '—'})
          </span>
        )}
      </div>

      <div className="px-3 py-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
        <Cell k="業種カテゴリ" v={d.industry_category} />
        <Cell k="業種(詳細)"   v={d.industry} />
        <Cell k="都道府県"     v={d.prefecture} />
        <Cell k="市区町村"     v={d.city} />
        <Cell k="代表者"       v={d.representative} />
        <Cell k="従業員数"     v={d.employee_count} />
      </div>
      {d.address && (
        <div className="px-3 pb-2 text-[11px]">
          <span className="text-zinc-500">住所:</span>{' '}
          <span className="text-zinc-800">{d.address}</span>
        </div>
      )}

      <div className="px-3 py-2 border-t border-emerald-100 grid grid-cols-4 gap-2 text-[11px]">
        <Kpi k="累計送信回数" v={sendCount.toLocaleString()} />
        <Kpi k="架電イベント" v={callCount} />
        <Kpi k="反応回数" v={responseCount} highlight={responseCount > 0} />
        <Kpi k="直近結果" v={d.last_result ? (RESULT_BADGE[d.last_result]?.label || d.last_result) : '—'} />
      </div>

      <div className="px-3 pb-2 text-[11px] text-zinc-600 flex flex-wrap gap-x-4 gap-y-0.5">
        <span>直近送信日: {fmtDate(d.last_sent_at)}</span>
        <span>直近PC: <span className="font-mono">{d.last_pc_number || '—'}</span></span>
      </div>

      <div className="border-t border-emerald-100">
        <button type="button" onClick={onToggleTimeline}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-emerald-100/60 flex items-center justify-between">
          <span>
            <span className="font-medium">過去アクション履歴</span>
            {!loading && <span className="ml-1 text-zinc-500">({(timeline || []).length} 件)</span>}
          </span>
          <span className="text-zinc-400 text-[10px]">{timelineExpanded ? '▲ 隠す' : '▼ 表示'}</span>
        </button>
        {timelineExpanded && (
          <div className="px-3 pb-2 max-h-60 overflow-auto">
            {loading ? (
              <div className="text-xs text-zinc-400 py-4 text-center">読み込み中…</div>
            ) : (timeline || []).length === 0 ? (
              <div className="text-xs text-zinc-400 py-4 text-center">アクション履歴なし</div>
            ) : (
              <ul className="space-y-1">
                {timeline.map((ev) => {
                  const evBadge = RESULT_BADGE[ev.event_type] || RESULT_BADGE[ev.result_label] || null;
                  return (
                    <li key={ev.id} className="bg-white border border-zinc-200 rounded px-2 py-1.5 text-[11px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-700 rounded text-[10px] font-mono">{CHANNEL_LABEL[ev.channel] || ev.channel}</span>
                        {evBadge ? (
                          <span className={`px-1.5 py-0.5 text-[10px] rounded ${evBadge.cls}`}>{evBadge.label}</span>
                        ) : (
                          <span className="text-zinc-700 font-medium">{ev.event_type}</span>
                        )}
                        <span className="text-zinc-500 ml-auto">{fmtDateTime(ev.occurred_at)}</span>
                      </div>
                      <div className="text-zinc-600 mt-0.5 flex flex-wrap gap-x-3">
                        {ev.pc_number       && <span>PC: <span className="font-mono">{ev.pc_number}</span></span>}
                        {ev.manuscript_slot != null && <span>原稿: {ev.manuscript_folder_date} / {ev.manuscript_slot}</span>}
                        {ev.operator_name   && <span>担当: {ev.operator_name}</span>}
                      </div>
                      {ev.memo && <div className="text-zinc-700 mt-0.5 truncate" title={ev.memo}>{ev.memo}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ k, v }) {
  return (
    <div className="flex gap-1.5 min-w-0">
      <span className="text-zinc-500 flex-shrink-0">{k}:</span>
      <span className="text-zinc-800 truncate" title={v == null || v === '' ? '' : String(v)}>
        {v == null || v === '' ? <span className="text-zinc-300">—</span> : String(v)}
      </span>
    </div>
  );
}
function Kpi({ k, v, highlight }) {
  return (
    <div className="bg-white border border-zinc-200 rounded px-2 py-1">
      <div className="text-[9px] text-zinc-500">{k}</div>
      <div className={`text-sm font-semibold ${highlight ? 'text-emerald-700' : 'text-zinc-800'}`}>{v}</div>
    </div>
  );
}
