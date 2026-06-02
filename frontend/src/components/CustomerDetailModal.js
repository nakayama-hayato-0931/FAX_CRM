import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const CHANNEL_META = {
  fax:     { label: 'FAX',     color: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
  call:    { label: 'コール',  color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  email:   { label: 'メール',  color: 'bg-sky-100 text-sky-700 border-sky-300' },
  sns:     { label: 'SNS',     color: 'bg-pink-100 text-pink-700 border-pink-300' },
  meeting: { label: '面談',    color: 'bg-amber-100 text-amber-700 border-amber-300' },
  other:   { label: 'その他',  color: 'bg-zinc-100 text-zinc-700 border-zinc-300' },
};

const EVENT_TYPE_LABEL = {
  send: '送信', response_inquiry: '受電(問合せ)', response_order: '受電(発注)',
  refusal: '拒否', invalid_number: '番号無効',
  outbound: '架電', no_answer: '不在', ng: 'NG', recall: 'リコール設定',
  interested: '興味あり', project: '案件化',
  sent: '送信', dm_sent: 'DM送信', other: 'その他',
};

const SOURCE_BADGE = {
  'fax-crm':       'bg-indigo-50 text-indigo-700',
  'callcenter-ai': 'bg-emerald-50 text-emerald-700',
  'manual':        'bg-zinc-50 text-zinc-700',
};

/**
 * 顧客詳細モーダル (ページ遷移せずに一覧の上に重ねる)
 *   Props:
 *     customerId      ... 必須
 *     initialTab      ... 'overview' (既定) / 'timeline' / 'calls'
 *     channelFilter   ... 'call' で通話のみ表示 (架電回数クリック時に使う)
 *     onClose         ... モーダル閉じる
 */
export default function CustomerDetailModal({ customerId, initialTab = 'overview', channelFilter = null, onClose }) {
  const [customer, setCustomer] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [cust, tl] = await Promise.all([
          api.get(`/api/customers/${customerId}`),
          api.get(`/api/customers/${customerId}/timeline?limit=200`).catch(() => ({ data: { data: [] } })),
        ]);
        if (cancelled) return;
        setCustomer(cust.data.data || null);
        setTimeline(tl.data.data || []);
      } catch (e) {
        if (!cancelled) toast.error(e.userMessage || '顧客情報の取得に失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [customerId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filteredTimeline = channelFilter
    ? timeline.filter((e) => e.channel === channelFilter)
    : timeline;

  const callCount = timeline.filter((e) => e.channel === 'call').length;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[1100px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="p-12 text-center text-zinc-400">読み込み中…</div>
        ) : !customer ? (
          <div className="p-12 text-center text-zinc-400">顧客情報を取得できませんでした</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">{customer.company_name}</h2>
                <p className="text-zinc-500 mt-0.5 text-xs">
                  ID: {customer.id}
                  {customer.fax_number && <> / FAX: <span className="font-mono">{customer.fax_number}</span></>}
                  {customer.phone_number && <> / 電話: <span className="font-mono">{customer.phone_number}</span></>}
                  {!customer.fax_number && !customer.phone_number && <span className="text-zinc-400 ml-1">(連絡先未登録)</span>}
                </p>
              </div>
              <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} title="閉じる (Esc)">✕</button>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-4 gap-3 px-6 pt-4">
              <Stat label="累計送信回数" value={customer.send_count ?? 0} />
              <Stat label="架電回数" value={callCount} />
              <Stat label="反応回数" value={customer.response_count ?? 0} />
              <Stat label="直近送信" value={customer.last_sent_at ? new Date(customer.last_sent_at).toLocaleDateString('ja-JP') : '—'} />
            </div>

            {/* Tabs */}
            <div className="px-6 mt-4 border-b border-zinc-200 flex gap-4 text-sm">
              {[
                { key: 'overview', label: '基本情報' },
                { key: 'timeline', label: `タイムライン${timeline.length ? ` (${timeline.length})` : ''}` },
                ...(channelFilter === 'call' ? [{ key: 'calls', label: `通話履歴${callCount ? ` (${callCount})` : ''}` }] : []),
              ].map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                        className={[
                          'pb-2 -mb-px border-b-2 transition',
                          activeTab === t.key ? 'border-indigo-600 text-indigo-700 font-medium' : 'border-transparent text-zinc-500 hover:text-zinc-700',
                        ].join(' ')}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto px-6 py-4">
              {activeTab === 'overview' && (
                <div className="bg-white">
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    <Row k="電話番号" v={customer.phone_number} />
                    <Row k="業種カテゴリ" v={customer.industry_category} />
                    <Row k="業種(詳細)" v={customer.industry} />
                    <Row k="都道府県" v={customer.prefecture} />
                    <Row k="市区町村" v={customer.city} />
                    <Row k="住所"     v={customer.address} />
                    <Row k="郵便番号" v={customer.postal_code} />
                    <Row k="URL"      v={customer.url} />
                    <Row k="代表者"   v={customer.representative} />
                    <Row k="従業員数" v={customer.employee_count} />
                    <Row k="ソース"   v={customer.source_file} />
                    <Row k="ブラックリスト" v={customer.is_blacklisted ? 'はい' : 'いいえ'} />
                    <Row k="callcenter ID" v={customer.external_callcenter_id} />
                    <Row k="備考" v={customer.note} />
                  </dl>
                </div>
              )}

              {(activeTab === 'timeline' || activeTab === 'calls') && (
                <Timeline events={activeTab === 'calls' ? filteredTimeline.filter((e) => e.channel === 'call') : filteredTimeline} />
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-zinc-200 flex justify-end flex-shrink-0">
              <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded p-3">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-xl font-bold text-zinc-900 mt-0.5">{value}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 py-1 border-b border-zinc-100/60 last:border-0">
      <dt className="text-xs text-zinc-500 pt-0.5">{k}</dt>
      <dd className="text-sm text-zinc-800 break-all">{v == null || v === '' ? <span className="text-zinc-300">—</span> : String(v)}</dd>
    </div>
  );
}

function Timeline({ events }) {
  if (!events || events.length === 0) {
    return <div className="text-center text-zinc-400 py-12 text-sm">該当するイベントがありません</div>;
  }
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-0 bottom-0 w-px bg-zinc-200" />
      <ul className="space-y-3">
        {events.map((ev) => {
          const meta = CHANNEL_META[ev.channel] || CHANNEL_META.other;
          const evLabel = EVENT_TYPE_LABEL[ev.event_type] || ev.event_type;
          const sourceBadge = SOURCE_BADGE[ev.source_system] || SOURCE_BADGE.manual;
          return (
            <li key={ev.id} className="relative">
              <span className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-white border-2 flex items-center justify-center" style={{ borderColor: 'currentColor' }}>
                <span className="block w-1.5 h-1.5 rounded-full bg-current" />
              </span>
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`px-2 py-0.5 text-xs rounded border ${meta.color} font-medium`}>{meta.label}</span>
                <span className="text-sm font-medium text-zinc-900">{evLabel}</span>
                <span className={`px-1.5 py-0.5 text-[10px] rounded ${sourceBadge}`}>{ev.source_system}</span>
                <span className="text-xs text-zinc-500 ml-auto">{new Date(ev.occurred_at).toLocaleString('ja-JP', { hour12: false })}</span>
              </div>
              <div className="mt-1 text-xs text-zinc-600 flex flex-wrap gap-3 pl-1">
                {ev.pc_number && <span>PC: <span className="font-mono">{ev.pc_number}</span></span>}
                {ev.manuscript_slot != null && <span>原稿: {ev.manuscript_folder_date} / {ev.manuscript_slot}</span>}
                {ev.operator_name && <span>担当: {ev.operator_name}</span>}
                {ev.result_label && ev.result_label !== ev.event_type && <span>結果: {ev.result_label}</span>}
              </div>
              {ev.memo && <div className="mt-1 text-xs text-zinc-700 bg-zinc-50 rounded px-2 py-1">{ev.memo}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
