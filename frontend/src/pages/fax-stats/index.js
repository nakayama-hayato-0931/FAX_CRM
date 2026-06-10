import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import { api } from '@/utils/api';
import FaxStatsImportModal from '@/components/FaxStatsImportModal';

// 期間プリセットから { from, to } の YYYY-MM-DD を返す
//   to は 当日分が常に 0 のため 前日 を上限にする
function computePresetRange(key) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (key === 'thisMonth') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    // 月初日が未来 (例: 月初に開いた場合) なら start=yesterday に合わせる
    const startSafe = start > yesterday ? yesterday : start;
    return { from: fmt(startSafe), to: fmt(yesterday) };
  }
  if (key === 'last3months') {
    // 当月含む直近3ヶ月: 例 5月なら 3/1〜前日
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    return { from: fmt(start), to: fmt(yesterday) };
  }
  // それ以外(custom含む)は空
  return { from: '', to: '' };
}

const PRESETS = [
  { key: 'thisMonth',   label: '当月' },
  { key: 'last3months', label: '直近3ヶ月' },
  { key: 'custom',      label: '任意の期間' },
];

const DEMO_DAILY = [
  { stat_date: '2026-05-08', sent: 2150, success: 1980, errors: 95,  busy: 55, no_answer: 18, invalid: 2,  error_rate: 4.42 },
  { stat_date: '2026-05-09', sent: 2480, success: 2280, errors: 130, busy: 48, no_answer: 19, invalid: 3,  error_rate: 5.24 },
  { stat_date: '2026-05-10', sent: 2310, success: 2150, errors: 105, busy: 42, no_answer: 11, invalid: 2,  error_rate: 4.55 },
  { stat_date: '2026-05-11', sent: 2620, success: 2435, errors: 121, busy: 51, no_answer: 11, invalid: 2,  error_rate: 4.62 },
  { stat_date: '2026-05-12', sent: 2789, success: 2598, errors: 134, busy: 41, no_answer: 13, invalid: 3,  error_rate: 4.80 },
  { stat_date: '2026-05-13', sent: 2412, success: 2210, errors: 145, busy: 40, no_answer: 14, invalid: 3,  error_rate: 6.01 },
  { stat_date: '2026-05-14', sent: 1880, success: 1745, errors:  98, busy: 24, no_answer: 11, invalid: 2,  error_rate: 5.21 },
  { stat_date: '2026-05-15', sent:  240, success:  215, errors:  18, busy:  5, no_answer:  2, invalid: 0,  error_rate: 7.50 },
];

const DEMO_BY_PC = [
  { pc_number: 'PC01', sent: 4520, success: 4180, errors: 245, success_rate: 92.48, error_rate: 5.42 },
  { pc_number: 'PC02', sent: 4310, success: 4015, errors: 215, success_rate: 93.16, error_rate: 4.99 },
  { pc_number: 'PC03', sent: 4180, success: 3870, errors: 232, success_rate: 92.58, error_rate: 5.55 },
  { pc_number: 'PC04', sent: 1950, success: 1810, errors:  98, success_rate: 92.82, error_rate: 5.03 },
  { pc_number: 'PC05', sent: 1921, success: 1738, errors: 156, success_rate: 90.47, error_rate: 8.12 },
];

const DEMO_DETAIL = (() => {
  const out = [];
  for (const d of DEMO_DAILY) {
    for (const p of ['PC01', 'PC02', 'PC03', 'PC04', 'PC05']) {
      const seed = d.stat_date.charCodeAt(9) + p.charCodeAt(3);
      const sent = Math.round(d.sent / 5 * (0.85 + (seed % 30) / 100));
      const err  = Math.round(sent * (0.04 + (seed % 4) / 100));
      out.push({
        id: out.length + 1,
        stat_date: d.stat_date,
        pc_number: p,
        sent_count: sent,
        success_count: sent - err - 5,
        error_count: err,
        busy_count: 4,
        no_answer_count: 1,
        invalid_count: 0,
        source: 'sheets',
        synced_at: '2026-05-15T08:00:00Z',
      });
    }
  }
  return out;
})();

const DEMO_CONFIG = {
  sheet_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  sheet_range: 'Log!A:H',
  last_synced_at: '2026-05-15T07:00:00Z',
  last_sync_status: 'ok',
  last_sync_message: '5件 新規 / 2件 更新',
};

export default function FaxStatsPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [loading, setLoading] = useState(false);
  const [daily, setDaily] = useState([]);
  const [byPc, setByPc] = useState([]);
  const [detail, setDetail] = useState([]);
  const [config, setConfig] = useState(null);
  const [filter, setFilter] = useState(() => ({
    ...computePresetRange('thisMonth'),  // 初期表示: 当月
    pcNumber: '',
  }));
  const [preset, setPreset] = useState('thisMonth');
  const [syncing, setSyncing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // PC明細モーダル: { pcNumber, from, to, rows, loading }
  const [pcDetail, setPcDetail] = useState(null);

  const reload = () => setReloadKey((k) => k + 1);

  // ESCで PC明細モーダルを閉じる
  useEffect(() => {
    if (!pcDetail) return;
    const onKey = (e) => { if (e.key === 'Escape') setPcDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pcDetail]);

  // PC別サマリ行クリック → モーダルで指定PCの日別明細を表示
  const openPcDetail = async (pcNumber) => {
    const from = filter.from || null;
    const to   = filter.to || null;
    setPcDetail({ pcNumber, from, to, rows: [], loading: true });
    if (isDemo) {
      // demo: 該当PC のダミー日次を返す
      const rows = (DEMO_DAILY || []).map((d) => ({
        stat_date: d.stat_date, pc_number: pcNumber,
        sent_count: Math.round((d.sent || 0) / 5),
        error_count: Math.round((d.errors || 0) / 5),
      }));
      setPcDetail({ pcNumber, from, to, rows, loading: false });
      return;
    }
    try {
      const { data } = await api.get('/api/fax-stats', {
        params: { from, to, pcNumber },
      });
      setPcDetail({ pcNumber, from, to, rows: data.data || [], loading: false });
    } catch (e) {
      toast.error(e.userMessage || '明細の取得に失敗');
      setPcDetail((p) => p && ({ ...p, loading: false, rows: [] }));
    }
  };

  const applyPreset = (key) => {
    setPreset(key);
    if (key === 'custom') {
      // 任意期間は from/to は維持(編集可)
      return;
    }
    setFilter((f) => ({ ...f, ...computePresetRange(key) }));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setDaily(DEMO_DAILY);
        setByPc(DEMO_BY_PC);
        setDetail(DEMO_DETAIL);
        setConfig(DEMO_CONFIG);
        return;
      }
      setLoading(true);
      try {
        const params = {};
        if (filter.from) params.from = filter.from;
        if (filter.to) params.to = filter.to;
        if (filter.pcNumber) params.pcNumber = filter.pcNumber;
        const [d, p, list, cfg] = await Promise.all([
          api.get('/api/fax-stats/daily', { params }),
          api.get('/api/fax-stats/by-pc', { params }),
          api.get('/api/fax-stats', { params }),
          api.get('/api/fax-stats/config'),
        ]);
        if (cancelled) return;
        setDaily(d.data.data || []);
        setByPc(p.data.data || []);
        setDetail(list.data.data || []);
        setConfig(cfg.data.data || null);
      } catch (e) {
        if (!cancelled) toast.error(e.userMessage || '読み込み失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey, filter.from, filter.to, filter.pcNumber]);

  const totals = useMemo(() => {
    // sent = 成功送信数, 試行数 = sent + errors
    const t = { sent: 0, errors: 0, days: daily.length };
    for (const d of daily) {
      t.sent += Number(d.sent || 0);
      t.errors += Number(d.errors || 0);
    }
    const attempts = t.sent + t.errors;
    t.attempts = attempts;
    t.error_rate = attempts ? ((t.errors / attempts) * 100).toFixed(2) : '0.00';
    return t;
  }, [daily]);

  // 折れ線チャート用に日付を昇順 + ラベルを短く
  const chartData = useMemo(() => {
    return [...daily].reverse().map((d) => ({
      date: d.stat_date?.slice(5) || '',  // MM-DD
      送信: Number(d.sent || 0),
      エラー: Number(d.errors || 0),
    }));
  }, [daily]);

  // 月別比較サマリ (直近3ヶ月などで使用)
  const monthlySummary = useMemo(() => {
    const byMonth = {};
    for (const d of daily) {
      const month = (d.stat_date || '').slice(0, 7);  // 'YYYY-MM'
      if (!month) continue;
      if (!byMonth[month]) byMonth[month] = { month, sent: 0, errors: 0, days: 0 };
      byMonth[month].sent += Number(d.sent || 0);
      byMonth[month].errors += Number(d.errors || 0);
      byMonth[month].days += 1;
    }
    return Object.values(byMonth)
      .map((m) => {
        const attempts = m.sent + m.errors;
        return {
          ...m,
          sent_avg: m.days ? Math.round(m.sent / m.days) : 0,
          errors_avg: m.days ? Math.round(m.errors / m.days) : 0,
          error_rate: attempts ? (m.errors / attempts) * 100 : 0,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [daily]);

  const sync = async (mode = 'recent') => {
    if (isDemo) { toast('デモ表示中は同期されません'); return; }
    setSyncing(true);
    try {
      const params = mode === 'recent' ? { recent: 1, days: 7 } : {};
      const { data } = await api.post('/api/fax-stats/sync', null, { params });
      const r = data.data || {};
      const scope = r.scope === 'full' ? '全件' : `直近${r.scope?.replace('recent', '').replace('d', '')}日`;
      toast.success(`同期完了 (${scope}): 新規${r.inserted} / 更新${r.updated}`);
      reload();
    } catch (e) {
      toast.error(e.userMessage || '同期失敗');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">FAX送信実績</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            FAX機ログ(Spreadsheet)を同期して PC別 / 日別に可視化
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reload} className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            再読み込み
          </button>
          <button onClick={() => setShowImport(true)} className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            CSV取込
          </button>
          <button onClick={() => sync('recent')} disabled={syncing}
                  title="直近7日分のみ upsert (高速)"
                  className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50">
            {syncing ? '同期中…' : '直近1週間同期'}
          </button>
          <button onClick={() => sync('full')} disabled={syncing}
                  title="全期間 を upsert (時間がかかる)"
                  className="px-3 py-2 text-sm bg-white border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50">
            {syncing ? '…' : '全件同期'}
          </button>
        </div>
      </div>

      {/* 期間プリセット切替 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-3 mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-zinc-500">期間:</span>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button key={p.key}
                    onClick={() => applyPreset(p.key)}
                    className={[
                      'px-3 py-1.5 text-sm rounded-md border transition',
                      preset === p.key
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50',
                    ].join(' ')}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input type="date" value={filter.from}
                   onChange={(e) => setFilter({ ...filter, from: e.target.value })}
                   className="border border-zinc-300 rounded px-2 py-1" />
            <span className="text-zinc-400">〜</span>
            <input type="date" value={filter.to}
                   onChange={(e) => setFilter({ ...filter, to: e.target.value })}
                   className="border border-zinc-300 rounded px-2 py-1" />
          </div>
        )}
        {preset !== 'custom' && filter.from && filter.to && (
          <span className="text-xs text-zinc-500 ml-2">
            {filter.from} 〜 {filter.to}
          </span>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="集計日数" value={totals.days} unit="日" />
        <Stat label="送信数(成功)" value={totals.sent.toLocaleString()} color="text-emerald-700" />
        <Stat label="エラー" value={totals.errors.toLocaleString()} color="text-red-700" />
        <Stat label="エラー率" value={`${totals.error_rate}%`} />
      </div>

      {/* Sheets連携状態 */}
      {config && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6 flex items-center justify-between flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-zinc-500 text-xs">シートID:</span>{' '}
              <code className="text-xs">{config.sheet_id ? config.sheet_id.slice(0, 12) + '…' : '未設定'}</code>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">範囲:</span>{' '}
              <code className="text-xs">{config.sheet_range || '—'}</code>
            </div>
            <div>
              <span className="text-zinc-500 text-xs">最終同期:</span>{' '}
              <span className="text-xs">{config.last_synced_at ? new Date(config.last_synced_at).toLocaleString('ja-JP') : '未実行'}</span>
              {config.last_sync_status && config.last_sync_status !== 'never' && (
                <span className={[
                  'ml-2 px-1.5 py-0.5 rounded text-[10px]',
                  config.last_sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                ].join(' ')}>
                  {config.last_sync_status === 'ok' ? 'OK' : 'ERROR'}
                </span>
              )}
            </div>
          </div>
          {config.last_sync_message && (
            <div className="text-xs text-zinc-500 truncate max-w-[400px]">{config.last_sync_message}</div>
          )}
        </div>
      )}

      {/* チャート */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-semibold text-zinc-800 mb-3">日別推移</h3>
        <div style={{ width: '100%', height: 280 }}>
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-zinc-400 text-sm">データなし</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 11, fill: '#71717a' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="送信"   stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="エラー" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 月別比較 (直近3ヶ月選択時のみ) */}
      {preset === 'last3months' && monthlySummary.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-zinc-200">
            <h3 className="text-sm font-semibold text-zinc-800">月別比較</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              直近3ヶ月の月ごとの合計と1日あたり平均
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-600 uppercase">
              <tr>
                <th className="text-left px-4 py-2">月</th>
                <th className="text-right px-4 py-2">データ日数</th>
                <th className="text-right px-4 py-2">送信数(合計)</th>
                <th className="text-right px-4 py-2">送信数(日平均)</th>
                <th className="text-right px-4 py-2">エラー(合計)</th>
                <th className="text-right px-4 py-2">エラー(日平均)</th>
                <th className="text-right px-4 py-2">エラー率</th>
              </tr>
            </thead>
            <tbody>
              {monthlySummary.map((m) => (
                <tr key={m.month} className="border-t border-zinc-100">
                  <td className="px-4 py-2 font-medium">{m.month.replace(/-0?/, '年') + '月'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-zinc-500">{m.days}日</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700 font-semibold">
                    {m.sent.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {m.sent_avg.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-700">
                    {m.errors.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {m.errors_avg.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {m.error_rate.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PC別サマリ */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">PC別サマリ</h3>
          {(filter.from || filter.to) && (
            <span className="text-[11px] text-zinc-500">
              期間: {filter.from || '〜'} 〜 {filter.to || '〜'} / {byPc.length} PC
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-zinc-600 uppercase">PC</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">送信数</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">エラー</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">エラー率</th>
            </tr>
          </thead>
          <tbody>
            {byPc.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-zinc-400">データがありません</td></tr>
            )}
            {byPc.map((p) => (
              <tr key={p.pc_number}
                  className="border-t border-zinc-100 hover:bg-emerald-50/40 cursor-pointer"
                  onClick={() => openPcDetail(p.pc_number)}
                  title="クリックで日別明細を表示">
                <td className="px-4 py-2 font-mono text-xs">
                  <span className="text-emerald-700 hover:underline">{p.pc_number}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{Number(p.sent || 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums text-red-700">{Number(p.errors || 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums">{Number(p.error_rate || 0).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 明細 */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-zinc-800">明細</h3>
            {(filter.from || filter.to) && (
              <span className="text-[11px] text-zinc-500">
                期間: {filter.from || '〜'} 〜 {filter.to || '〜'} / {detail.length} 件
              </span>
            )}
          </div>
          <div className="flex gap-2 text-xs items-center">
            <span className="text-zinc-400">PCで絞り込み:</span>
            <input type="text" placeholder="例: NO.1" value={filter.pcNumber}
                   onChange={(e) => setFilter({ ...filter, pcNumber: e.target.value })}
                   className="border border-zinc-300 rounded px-2 py-1 w-24" />
            {filter.pcNumber && (
              <button onClick={() => setFilter({ ...filter, pcNumber: '' })}
                      className="px-2 py-1 border border-zinc-300 rounded">クリア</button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-zinc-600 uppercase">日付</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-zinc-600 uppercase">PC</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">送信数</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">エラー</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-zinc-600 uppercase">取込元</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-400">読み込み中…</td></tr>
              )}
              {!loading && detail.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-400">
                  データがありません。「Sheets同期」または「CSV取込」を実行してください。
                </td></tr>
              )}
              {!loading && detail.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2 text-xs">{r.stat_date}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.pc_number}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{r.sent_count.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-700">{r.error_count.toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-100 text-zinc-600">{r.source}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <FaxStatsImportModal
          onClose={() => setShowImport(false)}
          onCompleted={() => { setShowImport(false); reload(); }}
        />
      )}

      {pcDetail && (
        <PcDailyDetailModal
          state={pcDetail}
          onClose={() => setPcDetail(null)}
        />
      )}
    </div>
  );
}

function PcDailyDetailModal({ state, onClose }) {
  const { pcNumber, from, to, rows, loading } = state || {};
  // 日付昇順で表示
  const sorted = useMemo(
    () => [...(rows || [])].sort((a, b) => String(a.stat_date).localeCompare(String(b.stat_date))),
    [rows]
  );
  const totals = useMemo(() => {
    let sent = 0, errors = 0;
    for (const r of sorted) {
      sent += Number(r.sent_count || r.sent || 0);
      errors += Number(r.error_count || r.errors || 0);
    }
    const attempts = sent + errors;
    return {
      sent, errors, attempts,
      error_rate: attempts ? (errors / attempts) * 100 : 0,
      days: sorted.length,
    };
  }, [sorted]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">
              <span className="font-mono">{pcNumber}</span> の日別明細
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              期間: {from || '〜'} 〜 {to || '〜'} / {totals.days} 日
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-100 text-zinc-500 text-xl leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-4 py-16 text-center text-zinc-400 text-sm">読み込み中…</div>
          ) : sorted.length === 0 ? (
            <div className="px-4 py-16 text-center text-zinc-400 text-sm">
              該当期間の明細データがありません
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-600 uppercase">日付</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">送信数</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">エラー</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-zinc-600 uppercase">エラー率</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const sent = Number(r.sent_count || r.sent || 0);
                  const err = Number(r.error_count || r.errors || 0);
                  const attempts = sent + err;
                  const rate = attempts ? (err / attempts) * 100 : 0;
                  return (
                    <tr key={r.id || `${r.stat_date}-${i}`} className="border-t border-zinc-100">
                      <td className="px-4 py-2 text-xs">{r.stat_date}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{sent.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-700">{err.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{rate.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-zinc-50 border-t border-zinc-200">
                <tr className="font-semibold">
                  <td className="px-4 py-2 text-xs text-zinc-700">合計</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{totals.sent.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-700">{totals.errors.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{totals.error_rate.toFixed(2)}%</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, color = 'text-zinc-900' }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>
        {value}
        {unit && <span className="text-sm text-zinc-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}
