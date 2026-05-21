import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const DEMO_MAP = {
  '1': {
    id: 1, company_name: '株式会社サンプル製作所', fax_number: '0312345678', phone_number: '0312345670',
    industry: '製造業', prefecture: '東京都', city: '千代田区', address: '丸の内1-1-1',
    postal_code: '100-0005', url: 'https://example.com', employee_count: 120, representative: '山田太郎',
    note: 'デモ用データ', send_count: 4, last_sent_at: '2026-04-22T10:00:00Z',
    last_pc_number: 'PC03', last_result: 'no_response', response_count: 0, is_blacklisted: 0,
    source_file: 'sample_customers.csv', imported_at: '2026-05-10T00:00:00Z',
    external_callcenter_id: 42,
  },
};

const DEMO_TIMELINE = [
  { id: 1, channel: 'call', event_type: 'outbound',         occurred_at: '2026-05-16T14:30:00+09:00', source_system: 'callcenter-ai', operator_name: 'taro@example.com',  pc_number: null,    memo: '営業時間外、明日リトライ予定', result_label: '不在' },
  { id: 2, channel: 'fax',  event_type: 'response_inquiry', occurred_at: '2026-05-15T14:30:00+09:00', source_system: 'fax-crm',       operator_name: null,                pc_number: 'NO.3',  memo: '見積依頼の電話あり',            result_label: 'response_inquiry' },
  { id: 3, channel: 'fax',  event_type: 'send',             occurred_at: '2026-05-15T09:00:00+09:00', source_system: 'fax-crm',       operator_name: null,                pc_number: 'NO.3',  memo: null,                            result_label: 'no_response' },
  { id: 4, channel: 'call', event_type: 'no_answer',        occurred_at: '2026-05-08T11:00:00+09:00', source_system: 'callcenter-ai', operator_name: 'hanako@example.com', pc_number: null,    memo: '営業電話 不在3回目',           result_label: '不在' },
  { id: 5, channel: 'fax',  event_type: 'send',             occurred_at: '2026-04-22T10:00:00+09:00', source_system: 'fax-crm',       operator_name: null,                pc_number: 'PC03',  memo: null,                            result_label: 'no_response' },
];

const CHANNEL_META = {
  fax:     { icon: '📠', label: 'FAX',     color: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
  call:    { icon: '📞', label: 'コール',  color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  email:   { icon: '✉️', label: 'メール',  color: 'bg-sky-100 text-sky-700 border-sky-300' },
  sns:     { icon: '💬', label: 'SNS',     color: 'bg-pink-100 text-pink-700 border-pink-300' },
  meeting: { icon: '👥', label: '面談',    color: 'bg-amber-100 text-amber-700 border-amber-300' },
  other:   { icon: '•',  label: 'その他', color: 'bg-zinc-100 text-zinc-700 border-zinc-300' },
};

const EVENT_TYPE_LABEL = {
  send: '送信', response_inquiry: '受電(問合せ)', response_order: '受電(発注)',
  refusal: '拒否', invalid_number: '番号無効',
  outbound: '架電', no_answer: '不在', ng: 'NG', recall: 'リコール設定',
  interested: '興味あり', project: '案件化',
  sent: '送信', dm_sent: 'DM送信', other: 'その他',
};

const SOURCE_BADGE = {
  'fax-crm': 'bg-indigo-50 text-indigo-700',
  'callcenter-ai': 'bg-emerald-50 text-emerald-700',
  'manual': 'bg-zinc-50 text-zinc-700',
};

export default function CustomerDetailPage() {
  const router = useRouter();
  // 動的ルート + クエリは router.isReady を待つと不安定なため window.location から直接パース
  const [routeInfo, setRouteInfo] = useState({ id: null, isDemo: false, ready: false });
  useEffect(() => {
    const m = window.location.pathname.match(/\/customers\/(\d+)/);
    const params = new URLSearchParams(window.location.search);
    setRouteInfo({
      id: m ? m[1] : null,
      isDemo: params.get('demo') === '1',
      ready: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { id, isDemo } = routeInfo;

  const [customer, setCustomer] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');  // overview / timeline

  useEffect(() => {
    if (!routeInfo.ready || !id) return;
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setCustomer(DEMO_MAP[String(id)] || null);
        setTimeline(DEMO_TIMELINE);
        return;
      }
      setLoading(true);
      try {
        const [c, t] = await Promise.all([
          api.get(`/api/customers/${id}`),
          api.get(`/api/customers/${id}/timeline`).catch(() => ({ data: { data: [] } })),
        ]);
        if (cancelled) return;
        setCustomer(c.data.data);
        setTimeline(t.data.data || []);
      } catch (e) {
        if (!cancelled) {
          toast.error(e.userMessage || '読み込み失敗');
          setCustomer(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [routeInfo.ready, id, isDemo]);

  if (loading) return <div className="text-zinc-400 py-12 text-center">読み込み中…</div>;
  if (!customer) return (
    <div>
      <Link href={`/customers${isDemo ? '?demo=1' : ''}`}
            className="text-sm text-indigo-700 hover:underline">← 顧客一覧へ</Link>
      <div className="text-zinc-400 py-12 text-center">顧客が見つかりません</div>
    </div>
  );

  return (
    <div>
      <Link href={`/customers${isDemo ? '?demo=1' : ''}`}
            className="text-sm text-indigo-700 hover:underline">← 顧客一覧へ</Link>

      <div className="mt-3 flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{customer.company_name}</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            ID: {customer.id} / FAX: <span className="font-mono">{customer.fax_number}</span>
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Stat label="累計送信回数" value={customer.send_count} />
        <Stat label="反応回数" value={customer.response_count} />
        <Stat label="直近送信"
              value={customer.last_sent_at ? new Date(customer.last_sent_at).toLocaleDateString('ja-JP') : '—'} />
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-200 mb-4 flex gap-4 text-sm">
        {[
          { key: 'overview', label: '基本情報' },
          { key: 'timeline', label: `タイムライン${timeline.length ? ` (${timeline.length})` : ''}` },
        ].map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={[
                    'pb-2 -mb-px border-b-2 transition',
                    activeTab === t.key
                      ? 'border-indigo-600 text-indigo-700 font-medium'
                      : 'border-transparent text-zinc-500 hover:text-zinc-700',
                  ].join(' ')}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <h3 className="font-semibold text-zinc-800 mb-3 text-sm">基本情報</h3>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row k="電話番号" v={customer.phone_number} />
            <Row k="業種" v={customer.industry} />
            <Row k="都道府県" v={customer.prefecture} />
            <Row k="市区町村" v={customer.city} />
            <Row k="住所" v={customer.address} />
            <Row k="郵便番号" v={customer.postal_code} />
            <Row k="URL" v={customer.url} />
            <Row k="代表者" v={customer.representative} />
            <Row k="従業員数" v={customer.employee_count} />
            <Row k="ソース" v={customer.source_file} />
            <Row k="ブラックリスト" v={customer.is_blacklisted ? 'はい' : 'いいえ'} />
            <Row k="callcenter ID" v={customer.external_callcenter_id} />
            <Row k="備考" v={customer.note} />
          </dl>
        </div>
      )}

      {activeTab === 'timeline' && <Timeline events={timeline} />}
    </div>
  );
}

function Timeline({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg p-8 text-center text-zinc-400 text-sm">
        まだイベントがありません。FAX送信や架電が記録されると、ここに時系列で表示されます。
      </div>
    );
  }
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <div className="relative pl-6">
        {/* 縦線 */}
        <div className="absolute left-2 top-0 bottom-0 w-px bg-zinc-200" />
        <ul className="space-y-4">
          {events.map((ev) => {
            const meta = CHANNEL_META[ev.channel] || CHANNEL_META.other;
            const evLabel = EVENT_TYPE_LABEL[ev.event_type] || ev.event_type;
            const sourceBadge = SOURCE_BADGE[ev.source_system] || SOURCE_BADGE.manual;
            return (
              <li key={ev.id} className="relative">
                {/* マーカー */}
                <span className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-white border-2 flex items-center justify-center"
                      style={{ borderColor: 'currentColor' }}>
                  <span className="block w-1.5 h-1.5 rounded-full bg-current" />
                </span>
                <div className="flex items-start gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 text-xs rounded border ${meta.color} font-medium`}>
                    {meta.icon} {meta.label}
                  </span>
                  <span className="text-sm font-medium text-zinc-900">{evLabel}</span>
                  <span className={`px-1.5 py-0.5 text-[10px] rounded ${sourceBadge}`}>
                    {ev.source_system}
                  </span>
                  <span className="text-xs text-zinc-500 ml-auto">
                    {new Date(ev.occurred_at).toLocaleString('ja-JP', { hour12: false })}
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-600 flex flex-wrap gap-3 pl-1">
                  {ev.pc_number && <span>PC: <span className="font-mono">{ev.pc_number}</span></span>}
                  {ev.manuscript_slot != null && (
                    <span>原稿: {ev.manuscript_folder_date} / {ev.manuscript_slot}</span>
                  )}
                  {ev.operator_name && <span>担当: {ev.operator_name}</span>}
                  {ev.result_label && ev.result_label !== ev.event_type && (
                    <span>結果: {ev.result_label}</span>
                  )}
                </div>
                {ev.memo && (
                  <div className="mt-1 text-xs text-zinc-700 bg-zinc-50 rounded px-2 py-1 pl-1">
                    {ev.memo}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-2xl font-bold text-zinc-900 mt-1">{value ?? '—'}</div>
    </div>
  );
}
function Row({ k, v }) {
  return (
    <div className="flex gap-3">
      <dt className="text-zinc-500 w-24 flex-shrink-0">{k}</dt>
      <dd className="text-zinc-800 break-all">{v || '—'}</dd>
    </div>
  );
}
