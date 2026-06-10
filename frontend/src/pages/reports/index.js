import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import IncomingCallManualModal from '@/components/IncomingCallManualModal';

const RESULT_LABEL = {
  // 新仕様
  project:          { label: '案件化',   cls: 'bg-emerald-100 text-emerald-800' },
  ng:               { label: 'NG',       cls: 'bg-red-100 text-red-700' },
  recall:           { label: 'リコール', cls: 'bg-sky-100 text-sky-700' },
  material_sent:    { label: '資料送付', cls: 'bg-amber-100 text-amber-800' },
  other:            { label: 'その他',   cls: 'bg-zinc-100 text-zinc-700' },
  // 旧仕様 (バッチ入力で残っている過去データ用)
  no_response:      { label: '受電なし', cls: 'bg-zinc-100 text-zinc-500' },
  response_inquiry: { label: '問合せ',   cls: 'bg-amber-100 text-amber-800' },
  response_order:   { label: '発注',     cls: 'bg-emerald-100 text-emerald-800' },
  refusal:          { label: '拒否',     cls: 'bg-red-100 text-red-700' },
  invalid_number:   { label: '番号無効', cls: 'bg-zinc-100 text-zinc-500' },
};

const RESULT_FILTER_KEYS = ['project','ng','recall','material_sent','other'];

const DEMO_REPORTS = [
  { id: 901, customer_id: 2, company_name: '合同会社テスト商事',     fax_number: '0623456789', industry: '卸売業',   prefecture: '大阪府', send_date: '2026-05-12', pc_number: 'PC01', manuscript_folder_date: '2026-05-12', manuscript_slot: 4,  result: 'response_inquiry', result_detail: '見積依頼の電話あり', responded_at: '2026-05-13T11:00:00Z' },
  { id: 902, customer_id: 3, company_name: 'ABC技研株式会社',        fax_number: '0523456789', industry: '情報通信', prefecture: '愛知県', send_date: '2026-05-10', pc_number: 'PC02', manuscript_folder_date: '2026-05-10', manuscript_slot: 1,  result: 'response_order',   result_detail: '初回発注確定',     responded_at: '2026-05-11T15:30:00Z' },
  { id: 903, customer_id: 4, company_name: '有限会社デモ建設',       fax_number: '0114567890', industry: '建設業',   prefecture: '北海道', send_date: '2026-05-08', pc_number: 'PC05', manuscript_folder_date: '2026-05-08', manuscript_slot: 7,  result: 'refusal',          result_detail: '送らないでとの連絡', responded_at: '2026-05-09T10:00:00Z' },
  { id: 904, customer_id: 1, company_name: '株式会社サンプル製作所', fax_number: '0312345678', industry: '製造業',   prefecture: '東京都', send_date: '2026-05-06', pc_number: 'PC03', manuscript_folder_date: '2026-05-06', manuscript_slot: 12, result: 'no_response',      result_detail: null,                responded_at: null },
];

export default function ReportsIndex() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ result: '', pcNumber: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [showManual, setShowManual] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) { setLoading(false); setItems(DEMO_REPORTS); return; }
      setLoading(true);
      try {
        const params = {};
        if (filter.result) params.result = filter.result;
        if (filter.pcNumber) params.pcNumber = filter.pcNumber;
        const { data } = await api.get('/api/incoming-calls', { params });
        if (!cancelled) setItems(data.data || []);
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey, filter.result, filter.pcNumber]);

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">受電報告</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            FAX送信に対する受電(電話・問合せ)の記録
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setReloadKey((k) => k + 1)}
                  className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            再読み込み
          </button>
          <button onClick={() => {
                    if (isDemo) { toast('デモ表示中は入力できません'); return; }
                    setShowManual(true);
                  }}
                  className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700">
            + 手動入力
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                  value={filter.result}
                  onChange={(e) => setFilter({ ...filter, result: e.target.value })}>
            <option value="">結果: すべて</option>
            {RESULT_FILTER_KEYS.map((k) => (
              <option key={k} value={k}>{RESULT_LABEL[k].label}</option>
            ))}
          </select>
          <input type="text" className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                 placeholder="PC番号で絞り込み (例: PC03)"
                 value={filter.pcNumber}
                 onChange={(e) => setFilter({ ...filter, pcNumber: e.target.value })} />
          <button className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md"
                  onClick={() => setFilter({ result: '', pcNumber: '' })}>
            条件クリア
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">送信日</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">会社名</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">FAX</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">PC</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">原稿</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">担当営業</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">結果</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">詳細</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">受電日時</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-zinc-400">読み込み中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-zinc-400">
                  受電報告がありません。バッチを開いて入力してください。
                </td></tr>
              )}
              {!loading && items.map((r) => {
                const meta = RESULT_LABEL[r.result] || RESULT_LABEL.other;
                return (
                  <tr key={r.id} className="border-t border-zinc-100 hover:bg-zinc-50/60 cursor-pointer"
                      onClick={() => setDetail(r)}>
                    <td className="px-4 py-2.5 text-xs">{r.send_date}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-emerald-700 hover:underline">{r.company_name}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.fax_number || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.pc_number}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {r.manuscript_folder_date ? `${r.manuscript_folder_date} / ${r.manuscript_slot}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{r.sales_owner || <span className="text-zinc-300">—</span>}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-700 max-w-[280px] truncate">{r.result_detail || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {r.responded_at ? new Date(r.responded_at).toLocaleString('ja-JP') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showManual && (
        <IncomingCallManualModal
          onClose={() => setShowManual(false)}
          onCompleted={() => { setShowManual(false); setReloadKey((k) => k + 1); }}
        />
      )}

      {detail && (
        <ReportDetailModal report={detail} onClose={() => setDetail(null)} isDemo={isDemo} />
      )}
    </div>
  );
}

function ReportDetailModal({ report, onClose, isDemo }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const meta = RESULT_LABEL[report.result] || RESULT_LABEL.other;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold text-zinc-900">受電報告 詳細</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">✕</button>
        </div>
        <div className="p-6 space-y-2 text-sm">
          <Row k="顧客">
            <Link href={`/customers/${report.customer_id}${isDemo ? '?demo=1' : ''}`}
                  className="text-emerald-700 hover:underline font-medium">{report.company_name}</Link>
            <span className="text-zinc-500 ml-2">ID: {report.customer_id}</span>
          </Row>
          <Row k="FAX番号" v={report.fax_number} mono />
          <Row k="送信日" v={report.send_date} />
          <Row k="使用PC" v={report.pc_number} mono />
          <Row k="原稿(登録番号)" v={report.candidate_registration_no} mono />
          <Row k="担当営業" v={report.sales_owner} />
          <Row k="原稿">
            {report.manuscript_folder_date
              ? <>{report.manuscript_folder_date} / スロット {report.manuscript_slot}</>
              : <span className="text-zinc-400">—</span>}
          </Row>
          <Row k="結果">
            <span className={`px-2 py-0.5 text-xs rounded-full ${meta.cls}`}>{meta.label}</span>
          </Row>
          <Row k="受電日時" v={report.responded_at ? new Date(report.responded_at).toLocaleString('ja-JP') : null} />
          <Row k="詳細メモ">
            {report.result_detail ? <pre className="whitespace-pre-wrap font-sans">{report.result_detail}</pre> : <span className="text-zinc-400">—</span>}
          </Row>
          <Row k="バッチID" v={report.batch_id || null} />
          <Row k="登録日時" v={report.recorded_at ? new Date(report.recorded_at).toLocaleString('ja-JP') : null} />
        </div>
        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">閉じる</button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, children, mono }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1 border-b border-zinc-100/60 last:border-0">
      <dt className="text-xs text-zinc-500 pt-0.5">{k}</dt>
      <dd className={`text-sm text-zinc-800 ${mono ? 'font-mono text-xs' : ''}`}>
        {children !== undefined
          ? children
          : (v == null || v === '' ? <span className="text-zinc-300">—</span> : String(v))}
      </dd>
    </div>
  );
}
