import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const GROUP_OPTIONS = [
  { key: 'region+industry+nationality', label: '地域 × 業種 × 国籍' },
  { key: 'region+industry',             label: '地域 × 業種' },
  { key: 'region+nationality',          label: '地域 × 国籍' },
  { key: 'industry+nationality',        label: '業種 × 国籍' },
  { key: 'region',                      label: '地域 のみ' },
  { key: 'industry',                    label: '業種 のみ' },
  { key: 'nationality',                 label: '国籍 のみ' },
];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function presetRange(kind) {
  const today = new Date();
  const to = ymd(today);
  if (kind === 'today') return { from: to, to };
  if (kind === 'thisMonth') {
    const from = ymd(new Date(today.getFullYear(), today.getMonth(), 1));
    return { from, to };
  }
  if (kind === 'last30') {
    const f = new Date(today); f.setDate(f.getDate() - 29);
    return { from: ymd(f), to };
  }
  if (kind === 'last90') {
    const f = new Date(today); f.setDate(f.getDate() - 89);
    return { from: ymd(f), to };
  }
  return { from: to, to };
}

export default function SendResultSummaryPage() {
  const init = presetRange('last30');
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [groupBy, setGroupBy] = useState('region+industry+nationality');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ rows: [], totals: { sent: 0, called: 0, projects: 0, callRate: 0, projectRate: 0 } });

  const reload = async () => {
    if (!from || !to) { toast.error('期間 (from / to) を入力してください'); return; }
    setLoading(true);
    try {
      const { data: r } = await api.get('/api/send-result-summary', { params: { from, to, groupBy } });
      setData(r.data || { rows: [], totals: {} });
    } catch (e) {
      toast.error(e.userMessage || '集計失敗');
    } finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const axes = (groupBy || '').split('+');
  const showRegion = axes.includes('region');
  const showIndustry = axes.includes('industry');
  const showNationality = axes.includes('nationality');

  const fmtPct = (v) => (v == null || isNaN(v)) ? '—' : `${Number(v).toFixed(1)}%`;
  const fmtNum = (v) => Number(v || 0).toLocaleString();

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">送信結果集計</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            抽出/格納時のフォルダ日付 (manuscript_folder_date) を基準に、 受電率 / 案件化率 を集計
          </p>
        </div>
      </div>

      {/* フィルタ */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-600 mb-1">期間 (送信日)</label>
            <div className="flex items-center gap-1">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                     className="border border-zinc-300 rounded-md px-2 py-1.5 text-sm" />
              <span className="text-zinc-400 text-xs">〜</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                     className="border border-zinc-300 rounded-md px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-1 mb-0.5">
            {[
              { k: 'today', label: '今日' },
              { k: 'thisMonth', label: '当月' },
              { k: 'last30', label: '直近30日' },
              { k: 'last90', label: '直近90日' },
            ].map((p) => (
              <button key={p.k} type="button"
                      onClick={() => { const r = presetRange(p.k); setFrom(r.from); setTo(r.to); }}
                      className="px-2 py-1.5 text-xs border border-zinc-300 rounded hover:bg-zinc-50">
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">集計軸</label>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
                    className="border border-zinc-300 rounded-md px-2 py-1.5 text-sm">
              {GROUP_OPTIONS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </div>
          <button onClick={reload} disabled={loading}
                  className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50">
            {loading ? '集計中…' : '集計'}
          </button>
        </div>
      </div>

      {/* サマリ KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Kpi label="送信先数" value={fmtNum(data.totals.sent)} />
        <Kpi label="受電数" value={fmtNum(data.totals.called)} color="text-emerald-700" />
        <Kpi label="受電率" value={fmtPct(data.totals.callRate)} color="text-emerald-700" />
        <Kpi label="案件化数" value={fmtNum(data.totals.projects)} color="text-amber-700" />
        <Kpi label="案件化率" value={fmtPct(data.totals.projectRate)} color="text-amber-700" />
      </div>

      {/* 内訳表 */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {showRegion       && <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">地域</th>}
                {showIndustry     && <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">業種</th>}
                {showNationality  && <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">原稿国籍</th>}
                <th className="text-right px-3 py-2 text-xs font-medium text-zinc-600 w-24">送信先数</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-zinc-600 w-24">受電数</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-zinc-600 w-20">受電率</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-zinc-600 w-24">案件化数</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-zinc-600 w-20">案件化率</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={5 + [showRegion, showIndustry, showNationality].filter(Boolean).length}
                      className="px-3 py-12 text-center text-zinc-400">
                    {loading ? '集計中…' : '対象データなし (この期間の送信履歴がありません)'}
                  </td>
                </tr>
              )}
              {data.rows.map((r, i) => (
                <tr key={i} className="border-b border-zinc-100 hover:bg-zinc-50/60">
                  {showRegion       && <td className="px-3 py-1.5 text-zinc-800">{r.region || '—'}</td>}
                  {showIndustry     && <td className="px-3 py-1.5 text-zinc-700">{r.industry_category || '—'}</td>}
                  {showNationality  && <td className="px-3 py-1.5 text-zinc-700">{r.nationality || '—'}</td>}
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-900 font-medium">{fmtNum(r.sent)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmtNum(r.called)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{fmtPct(r.callRate)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{fmtNum(r.projects)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{fmtPct(r.projectRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500 mt-3 leading-relaxed">
        ※ 送信 = リスト抽出 → Drive 格納 時に記録された contact_events (channel=fax, event_type=send)。
        受電 = 同じ顧客に 抽出日以降に call イベント (callcenter / 受電報告) があれば 1 カウント。
        案件化 = sales_projects.acquired_date が 抽出日以降に発生した同名企業をカウント。
      </p>
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${color || 'text-zinc-900'}`}>{value}</div>
    </div>
  );
}
