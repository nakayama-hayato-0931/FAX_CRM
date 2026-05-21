import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import CpaImportModal from '@/components/CpaImportModal';
import OutsourcedFaxSection from '@/components/OutsourcedFaxSection';
import SalesProjectsDetailModal from '@/components/SalesProjectsDetailModal';

// ROAS = first_payment / cost * 100
const DEMO_ROWS = [
  { month: '2025-12-01', cost: 1040283, sends: 10831, project_rate: 0.42, projects: 45, project_cpa: 23117, interviews: 30, interview_cpa: 34676, interview_rate: 66.67, offers: 11, rejects: 18, cancels: 14, first_payment: 3420000, expected_revenue: 7020000, roas: 328.76 },
  { month: '2026-01-01', cost:  883157, sends:  7753, project_rate: 0.68, projects: 53, project_cpa: 16663, interviews: 29, interview_cpa: 30454, interview_rate: 54.72, offers: 13, rejects: 17, cancels: 17, first_payment: 4736000, expected_revenue: 6736000, roas: 536.26 },
  { month: '2026-02-01', cost:  835599, sends:  6962, project_rate: 0.72, projects: 50, project_cpa: 16712, interviews: 37, interview_cpa: 22584, interview_rate: 74.00, offers: 13, rejects: 24, cancels: 12, first_payment: 2760000, expected_revenue: 7310000, roas: 330.30 },
  { month: '2026-03-01', cost: 1120097, sends:  7925, project_rate: 0.69, projects: 55, project_cpa: 20365, interviews: 23, interview_cpa: 48700, interview_rate: 41.82, offers: 11, rejects:  4, cancels: 21, first_payment: 1680000, expected_revenue: 3730000, roas: 149.99 },
  { month: '2026-04-01', cost:  868799, sends:  7411, project_rate: 0.89, projects: 66, project_cpa: 13164, interviews: 20, interview_cpa: 43440, interview_rate: 30.30, offers:  6, rejects:  9, cancels: 22, first_payment: 1540000, expected_revenue: 1540000, roas: 177.26 },
  { month: '2026-05-01', cost:  121249, sends:  2006, project_rate: 1.25, projects: 25, project_cpa:  4850, interviews:  0, interview_cpa: 0,     interview_rate:  0.00, offers:  0, rejects:  0, cancels:  1, first_payment:       0, expected_revenue:       0, roas:   0.00 },
];

const yen = (v) => (v == null ? '—' : '¥' + Number(v).toLocaleString());
const num = (v) => (v == null ? '—' : Number(v).toLocaleString());
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(2)}%`);

// 列定義: kind=raw(実数, 黒) / kind=derived(算出, 青背景) / clickable=trueでクリック可能セル
const COLUMNS = [
  { key: 'month',           label: '期間',              kind: 'raw',     format: (v) => formatMonth(v), align: 'left' },
  { key: 'cost',            label: 'コスト',             kind: 'raw',     format: yen, align: 'right' },
  { key: 'sends',           label: '送信数',             kind: 'raw',     format: num, align: 'right' },
  { key: 'project_rate',    label: '案件化率',           kind: 'derived', format: pct, align: 'right' },
  { key: 'projects',        label: 'FAXからの総案件数',   kind: 'raw',     format: num, align: 'right' },
  { key: 'project_cpa',     label: '案件CPA',            kind: 'derived', format: yen, align: 'right' },
  { key: 'interviews',      label: '面接数',             kind: 'raw',     format: num, align: 'right' },
  { key: 'interview_cpa',   label: '面接CPA',            kind: 'derived', format: yen, align: 'right' },
  { key: 'interview_rate',  label: '面接実施率',          kind: 'derived', format: pct, align: 'right' },
  { key: 'offers',          label: '内定社数',            kind: 'raw',     format: num, align: 'right', clickable: true },
  { key: 'rejects',         label: '不合格',             kind: 'raw',     format: num, align: 'right' },
  { key: 'cancels',         label: 'バラシ/失注',         kind: 'raw',     format: num, align: 'right' },
  { key: 'first_payment',   label: '初回入金',            kind: 'raw',     format: yen, align: 'right' },
  { key: 'expected_revenue',label: '見込売上',            kind: 'raw',     format: yen, align: 'right' },
  { key: 'roas',            label: 'ROAS',              kind: 'derived', format: pct, align: 'right' },
];

function formatMonth(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export default function CpaPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState(false);
  // 内定詳細モーダル: {month: 'YYYY-MM-01', monthLabel: '2026年5月', offersCount: 27}
  const [detailMonth, setDetailMonth] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const syncProjects = async () => {
    if (isDemo) { toast('デモ表示中は同期されません', { icon: 'ℹ' }); return; }
    setSyncingProjects(true);
    try {
      const { data } = await api.post('/api/sales-projects/sync');
      const r = data.data || {};
      toast.success(`案件同期OK: 取込${r.kept ?? 0} / 新規${r.inserted ?? 0} / 更新${r.updated ?? 0}`);
      reload();
    } catch (e) {
      toast.error(e.userMessage || '案件同期失敗。設定画面でシートIDを確認してください');
    } finally {
      setSyncingProjects(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setRows(DEMO_ROWS);
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get('/api/cpa/monthly', { params: { months: 12 } });
        if (!cancelled) setRows(data.data || []);
      } catch (err) {
        if (!cancelled) {
          toast.error(err.userMessage || '読み込み失敗');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">CPA指標</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            期間比較 / 直近12ヶ月
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            再読み込み
          </button>
          <button
            onClick={syncProjects}
            disabled={syncingProjects}
            className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
            title="『ビザ申請 進捗』シートから内定案件を再同期"
          >
            {syncingProjects ? '案件同期中…' : '案件シート同期'}
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            CSVインポート
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-xs text-zinc-600">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-white border border-zinc-300" />
          <span>実数(CSV取込)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-200" />
          <span>算出(自動計算)</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={[
                      'px-3 py-2.5 text-xs font-medium uppercase tracking-wider whitespace-nowrap',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.kind === 'derived' ? 'text-indigo-700 bg-indigo-50/60' : 'text-zinc-600',
                    ].join(' ')}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-zinc-400">
                  読み込み中…
                </td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length} className="px-3 py-12 text-center text-zinc-400">
                  データがありません。「CSVインポート」から実績データを取り込んでください。
                </td></tr>
              )}
              {!loading && rows.map((row) => (
                <tr key={row.month} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                  {COLUMNS.map((c) => {
                    const value = row[c.key];
                    const isClickable = c.clickable && Number(value) > 0;
                    const cellClass = [
                      'px-3 py-2.5 whitespace-nowrap tabular-nums',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.kind === 'derived' ? 'bg-indigo-50/40 text-indigo-900 font-medium' : 'text-zinc-800',
                    ].join(' ');
                    return (
                      <td key={c.key} className={cellClass}>
                        {isClickable ? (
                          <button
                            type="button"
                            onClick={() => setDetailMonth({
                              month: row.month,
                              monthLabel: formatMonth(row.month),
                              offersCount: Number(value),
                            })}
                            className="text-indigo-600 hover:text-indigo-800 underline underline-offset-2 font-medium"
                            title="内定社の内訳を表示"
                          >
                            {c.format(value)}
                          </button>
                        ) : (
                          c.format(value)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-xs text-zinc-500 leading-relaxed">
        ※ 案件化率 = 案件数 / 送信数 / 案件CPA = コスト / 案件数 / 面接CPA = コスト / 面接数 /
          面接実施率 = 面接数 / 案件数 / <strong>ROAS = 初回入金 / コスト</strong>
        <br />
        ※ 「コスト」「送信数」は <strong>自社FAX(Sheets同期)+ 委託FAX(下記の手入力分)</strong> の合算です。
        <br />
        ※ 「FAXからの総案件数」「内定社数」「初回入金」「見込売上」は <strong>案件シート(『ビザ申請 進捗』)</strong> から同期されます。
        <br />
        　・<strong>総案件数</strong> = FAX受電由来の全行(取消/辞退も含む)
        　・<strong>内定社数</strong> = 取消/辞退を除いたアクティブ案件(クリックで詳細内訳を表示)
        　・月キーは BK列「案件取得日」。取消/辞退の行は金額0扱い
      </div>

      {/* 委託送信 月別実績 */}
      <OutsourcedFaxSection isDemo={isDemo} onChanged={reload} />

      {showImport && (
        <CpaImportModal
          onClose={() => setShowImport(false)}
          onCompleted={() => { setShowImport(false); reload(); }}
        />
      )}

      {detailMonth && (
        <SalesProjectsDetailModal
          month={detailMonth.month}
          monthLabel={detailMonth.monthLabel}
          expectedCount={detailMonth.offersCount}
          onClose={() => setDetailMonth(null)}
        />
      )}
    </div>
  );
}
