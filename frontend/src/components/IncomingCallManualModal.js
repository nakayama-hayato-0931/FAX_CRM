import { useEffect, useState } from 'react';
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
 *   - 会社名検索で customer を選択
 *   - 送信日 / PC / 原稿 (任意) / 結果 / 詳細 / 受電日時 (任意) を入力
 *   - POST /api/incoming-calls
 */
export default function IncomingCallManualModal({ onClose, onCompleted, initial = {} }) {
  // 顧客入力モード: 'search' = 既存検索 / 'direct' = 会社名/電話/FAX を直接入力
  const [mode, setMode] = useState('search');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [customer, setCustomer] = useState(initial.customer || null);
  // 選択した顧客の詳細 (基本情報 + アクション履歴)
  const [customerDetail, setCustomerDetail] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  // 直接入力モード用
  const [direct, setDirect] = useState({ company_name: '', fax_number: '', phone_number: '' });

  // 今 を datetime-local 形式 (YYYY-MM-DDTHH:mm) で初期化
  const nowLocal = (() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  const [form, setForm] = useState({
    sendDate: initial.sendDate || '',
    pcNumber: initial.pcNumber || '',
    candidateRegistrationNo: initial.candidateRegistrationNo || '',
    salesOwner: initial.salesOwner || '',
    result: initial.result || 'project',
    resultDetail: '',
    respondedAt: initial.respondedAt || nowLocal,
  });
  const [busy, setBusy] = useState(false);

  // 顧客選択時:
  //   1) customers の last_sent_at / last_pc_number から 送信日 / 使用PC を補完
  //   2) その顧客の最新 incoming_call_report から 原稿(登録番号) を補完
  //   3) 詳細 (基本情報) と アクション履歴 を取得して 上部パネルに表示
  useEffect(() => {
    if (!customer) {
      setCustomerDetail(null);
      setTimeline([]);
      setTimelineExpanded(false);
      return;
    }
    setForm((f) => ({
      ...f,
      sendDate: customer.last_sent_at ? new Date(customer.last_sent_at).toISOString().slice(0, 10) : f.sendDate,
      pcNumber: customer.last_pc_number || f.pcNumber,
    }));
    api.get('/api/incoming-calls/last', { params: { customer_id: customer.id } })
      .then((r) => {
        const last = r.data?.data;
        if (!last) return;
        setForm((f) => ({
          ...f,
          candidateRegistrationNo: last.candidate_registration_no || f.candidateRegistrationNo,
          // 担当営業も最新報告から補完 (上書きは行わない)
          salesOwner: f.salesOwner || last.sales_owner || '',
        }));
      })
      .catch(() => { /* ignore */ });
    // 詳細 + タイムライン
    setLoadingDetail(true);
    setCustomerDetail(null);
    setTimeline([]);
    setTimelineExpanded(false);
    Promise.all([
      api.get(`/api/customers/${customer.id}`).catch(() => ({ data: { data: null } })),
      api.get(`/api/customers/${customer.id}/timeline`, { params: { limit: 50 } }).catch(() => ({ data: { data: [] } })),
    ]).then(([d, t]) => {
      setCustomerDetail(d.data?.data || null);
      setTimeline(t.data?.data || []);
    }).finally(() => setLoadingDetail(false));
  }, [customer]);

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
    if (!form.respondedAt) { toast.error('受電日時 は必須'); return; }
    if (!form.result)      { toast.error('結果 は必須'); return; }

    let customerId = customer?.id;

    // 直接入力モードなら quick-create で顧客を確保してから報告を保存
    if (mode === 'direct' && !customerId) {
      const c = direct.company_name.trim();
      const f = direct.fax_number;
      const p = direct.phone_number;
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

    if (!customerId) { toast.error('顧客を選択 or 直接入力してください'); return; }

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

  // 電話 / FAX の onChange: 全角数字を即座に半角に変換、 全角入力を弾く
  const onDigitChange = (key, raw) => {
    const normalized = normalizeDigit(raw);
    if (normalized !== raw && /[^\x00-\x7F]/.test(raw)) {
      // 全角文字が含まれていた場合は警告 (静かに) → 1回だけ
      toast('全角は半角に自動変換しました', { icon: 'ℹ', duration: 1500 });
    }
    setDirect((d) => ({ ...d, [key]: normalized }));
  };

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

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
            {/* 顧客 — モード切替 */}
            <div>
              <div className="text-xs font-medium text-zinc-700 mb-1.5">顧客 *</div>
              <div className="inline-flex rounded-md border border-zinc-300 overflow-hidden mb-2">
                <button type="button"
                        onClick={() => { setMode('search'); setCustomer(null); }}
                        className={['px-3 py-1.5 text-xs transition',
                          mode === 'search' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-50'].join(' ')}>
                  既存顧客を検索
                </button>
                <button type="button"
                        onClick={() => { setMode('direct'); setCustomer(null); }}
                        className={['px-3 py-1.5 text-xs transition border-l border-zinc-300',
                          mode === 'direct' ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-700 hover:bg-zinc-50'].join(' ')}>
                  直接入力
                </button>
              </div>

              {mode === 'search' && (
                customer ? (
                  <SelectedCustomerPanel
                    customer={customer}
                    detail={customerDetail}
                    timeline={timeline}
                    timelineExpanded={timelineExpanded}
                    onToggleTimeline={() => setTimelineExpanded((v) => !v)}
                    loading={loadingDetail}
                    onChange={() => setCustomer(null)}
                  />
                ) : (
                  <>
                    <input type="text" value={query}
                           onChange={(e) => setQuery(e.target.value)}
                           placeholder="会社名 / 電話番号 / FAX番号 で検索"
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
                    {query.length >= 2 && !searching && candidates.length === 0 && (
                      <div className="mt-1 text-xs text-zinc-500 bg-amber-50 border border-amber-200 rounded p-2">
                        該当顧客が見つかりません。 「直接入力」 タブで会社名 / 電話 / FAX を入力してください。
                      </div>
                    )}
                  </>
                )
              )}

              {mode === 'direct' && (
                <div className="bg-zinc-50 border border-zinc-200 rounded p-3 space-y-2">
                  <div className="text-[11px] text-zinc-500 mb-1">
                    会社名 / 電話 / FAX の<strong>いずれか1つ以上</strong>を入力。 既存と同じ電話/FAXがあれば自動再利用します。
                  </div>
                  <input type="text" value={direct.company_name}
                         onChange={(e) => setDirect({ ...direct, company_name: e.target.value })}
                         placeholder="会社名 (任意)"
                         className="rep-input" />
                  <input type="tel" value={direct.phone_number}
                         onChange={(e) => onDigitChange('phone_number', e.target.value)}
                         inputMode="numeric"
                         placeholder="電話番号 (例: 03-1234-5678 / 全角→半角自動変換)"
                         className="rep-input font-mono" />
                  <input type="tel" value={direct.fax_number}
                         onChange={(e) => onDigitChange('fax_number', e.target.value)}
                         inputMode="numeric"
                         placeholder="FAX番号 (例: 03-1234-5679 / 全角→半角自動変換)"
                         className="rep-input font-mono" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="受電日時 *">
                <input type="datetime-local" required value={form.respondedAt}
                       onChange={(e) => setForm({ ...form, respondedAt: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label={`送信日${mode === 'search' && customer ? ' (自動入力)' : ' (任意)'}`}
                     hint={mode === 'search' && customer ? '顧客の最終送信から補完済み (変更可)' : '不明なら空欄でOK'}>
                <input type="date" value={form.sendDate}
                       onChange={(e) => setForm({ ...form, sendDate: e.target.value })}
                       className="rep-input" />
              </Field>
              <Field label={`使用PC${mode === 'search' && customer ? ' (自動入力)' : ' (任意)'}`}
                     hint={mode === 'search' && customer ? '顧客の最終PCから補完済み (変更可)' : '不明なら空欄でOK'}>
                <input type="text" value={form.pcNumber}
                       onChange={(e) => setForm({ ...form, pcNumber: e.target.value })}
                       placeholder="NO.3" className="rep-input font-mono" />
              </Field>
            </div>

            <Field label="原稿 (履歴書 登録番号)"
                   hint={mode === 'search' && customer
                     ? '顧客の最終報告から自動補完 (変更可)。 同じ求職者で連続入力するならそのまま'
                     : '例: QT4654 / CZ5995 等。 直接入力 OK'}>
              <input type="text" value={form.candidateRegistrationNo}
                     onChange={(e) => setForm({ ...form, candidateRegistrationNo: e.target.value })}
                     placeholder="QT4654 等"
                     className="rep-input font-mono" />
            </Field>

            <Field label="担当営業"
                   hint={mode === 'search' && customer
                     ? '同顧客の前回報告から自動補完 (変更可)'
                     : '応対した営業担当者の名前 (任意)'}>
              <input type="text" value={form.salesOwner}
                     onChange={(e) => setForm({ ...form, salesOwner: e.target.value })}
                     placeholder="例: 山田 / 佐藤 等"
                     className="rep-input" />
            </Field>

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

          <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
              キャンセル
            </button>
            <button type="submit"
                    disabled={busy || (mode === 'search' && !customer) ||
                              (mode === 'direct' && !direct.company_name.trim() && !direct.fax_number && !direct.phone_number)}
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

function fmtDate(v)     { if (!v) return '—'; try { return new Date(v).toLocaleDateString('ja-JP'); } catch (_) { return String(v).slice(0, 10); } }
function fmtDateTime(v) { if (!v) return '—'; try { return new Date(v).toLocaleString('ja-JP', { hour12: false }); } catch (_) { return String(v); } }

function SelectedCustomerPanel({ customer, detail, timeline, timelineExpanded, onToggleTimeline, loading, onChange }) {
  // detail があれば優先 (より新鮮)、無ければ customer (検索結果) を使う
  const d = detail || customer;
  const isBL = !!d.is_blacklisted;
  const sendCount = Number(d.send_count || 0);
  const responseCount = Number(d.response_count || 0);
  const callCount = (timeline || []).filter((e) => e.channel === 'call').length;
  const faxEventCount = (timeline || []).filter((e) => e.channel === 'fax').length;

  return (
    <div className="bg-indigo-50/60 border border-indigo-200 rounded">
      {/* ヘッダ: 会社名 + 変更ボタン */}
      <div className="flex items-start justify-between px-3 py-2 border-b border-indigo-100">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-zinc-900 truncate">{d.company_name}</div>
          <div className="text-xs text-zinc-600 mt-0.5">
            {d.fax_number && <>FAX: <span className="font-mono">{d.fax_number}</span>{' '}</>}
            {d.phone_number && <>/ 電話: <span className="font-mono">{d.phone_number}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          {isBL && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-100 text-red-700 font-medium" title={d.blacklisted_reason || ''}>
              ブラック ({d.blacklisted_reason || '—'})
            </span>
          )}
          <button type="button" onClick={onChange}
                  className="text-xs text-indigo-700 hover:underline">変更</button>
        </div>
      </div>

      {/* 主要メタ + KPI */}
      <div className="px-3 py-2 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
        <Cell k="業種カテゴリ" v={d.industry_category} />
        <Cell k="業種(詳細)"   v={d.industry} />
        <Cell k="都道府県"     v={d.prefecture} />
        <Cell k="市区町村"     v={d.city} />
        <Cell k="代表者"       v={d.representative} />
        <Cell k="従業員数"     v={d.employee_count} />
        <Cell k="郵便番号"     v={d.postal_code} />
        <Cell k="ソース"       v={d.source_file} />
        <Cell k="callcenter ID" v={d.external_callcenter_id} />
      </div>
      {d.address && (
        <div className="px-3 pb-2 text-[11px]">
          <span className="text-zinc-500">住所:</span>{' '}
          <span className="text-zinc-800">{d.address}</span>
        </div>
      )}
      {d.url && (
        <div className="px-3 pb-2 text-[11px]">
          <span className="text-zinc-500">URL:</span>{' '}
          <a href={d.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline break-all">{d.url}</a>
        </div>
      )}

      {/* KPI バー */}
      <div className="px-3 py-2 border-t border-indigo-100 grid grid-cols-4 gap-2 text-[11px]">
        <Kpi k="累計送信回数" v={sendCount.toLocaleString()} />
        <Kpi k="架電イベント" v={callCount} />
        <Kpi k="反応回数" v={responseCount} highlight={responseCount > 0} />
        <Kpi k="直近結果" v={d.last_result ? (RESULT_BADGE[d.last_result]?.label || d.last_result) : '—'} />
      </div>

      {/* 直近送信 / 直近 PC */}
      <div className="px-3 pb-2 text-[11px] text-zinc-600 flex flex-wrap gap-x-4 gap-y-0.5">
        <span>直近送信日: {fmtDate(d.last_sent_at)}</span>
        <span>直近PC: <span className="font-mono">{d.last_pc_number || '—'}</span></span>
      </div>

      {/* タイムライン (折りたたみ) */}
      <div className="border-t border-indigo-100">
        <button type="button" onClick={onToggleTimeline}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-700 hover:bg-indigo-100/60 flex items-center justify-between">
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
                        {ev.pc_number && <span>PC: <span className="font-mono">{ev.pc_number}</span></span>}
                        {ev.manuscript_slot != null && <span>原稿: {ev.manuscript_folder_date} / {ev.manuscript_slot}</span>}
                        {ev.operator_name && <span>担当: {ev.operator_name}</span>}
                        {ev.source_system && <span className="text-zinc-400">[{ev.source_system}]</span>}
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
