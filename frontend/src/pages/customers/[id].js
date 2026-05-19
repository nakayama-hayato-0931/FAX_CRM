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
  },
};

export default function CustomerDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const isDemo = router.query.demo === '1';
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setCustomer(DEMO_MAP[String(id)] || null);
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get(`/api/customers/${id}`);
        if (!cancelled) setCustomer(data.data);
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
  }, [router.isReady, id, isDemo]);

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
          <Row k="備考" v={customer.note} />
        </dl>
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
