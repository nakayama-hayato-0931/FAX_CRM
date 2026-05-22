import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import CpaImportModal from '@/components/CpaImportModal';
import OutsourcedFaxSection from '@/components/OutsourcedFaxSection';
import SalesProjectsDetailModal from '@/components/SalesProjectsDetailModal';
import InterviewsDetailModal from '@/components/InterviewsDetailModal';
import JobPostingsDetailModal from '@/components/JobPostingsDetailModal';

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
  { key: 'projects',        label: '案件数',             kind: 'raw',     format: num, align: 'right', clickable: 'projects' },
  { key: 'project_cpa',     label: '案件CPA',            kind: 'derived', format: yen, align: 'right' },
  { key: 'interviews',      label: '面接数',             kind: 'raw',     format: num, align: 'right', clickable: 'interviews' },
  { key: 'interview_cpa',   label: '面接CPA',            kind: 'derived', format: yen, align: 'right' },
  { key: 'interview_rate',  label: '面接実施率',          kind: 'derived', format: pct, align: 'right' },
  { key: 'offers',          label: '内定社数',            kind: 'raw',     format: num, align: 'right', clickable: 'offers' },
  { key: 'rejects',         label: '不合格',             kind: 'raw',     format: num, align: 'right' },
  { key: 'cancels',         label: 'バラシ',             kind: 'raw',     format: num, align: 'right', clickable: 'cancels' },
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
  const [syncingInterviews, setSyncingInterviews] = useState(false);
  // 月キーの基準列: 'acquired' (BK列=案件取得日、 既定) / 'offer' (A列=内定日)
  const [basis, setBasis] = useState('acquired');
  // 内定詳細モーダル: {month: 'YYYY-MM-01', monthLabel: '2026年5月', offersCount: 27}
  const [detailMonth, setDetailMonth] = useState(null);
  // 面接詳細モーダル: {month, monthLabel, interviewsCount}
  const [interviewDetailMonth, setInterviewDetailMonth] = useState(null);
  // 求人詳細モーダル: {month, monthLabel, filter:'all'|'cancelled', expectedCount}
  const [jobsDetail, setJobsDetail] = useState(null);
  const [syncingJobs, setSyncingJobs] = useState(false);

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

  const syncJobs = async () => {
    if (isDemo) { toast('デモ表示中は同期されません', { icon: 'ℹ' }); return; }
    setSyncingJobs(true);
    try {
      const { data } = await api.post('/api/job-postings/sync');
      const r = data.data || {};
      toast.success(`案件同期OK: 取込${r.kept ?? 0} / 新規${r.inserted ?? 0} / 更新${r.updated ?? 0} (バラシ ${r.cancelledCount ?? 0})`);
      reload();
    } catch (e) {
      toast.error(e.userMessage || '案件シート同期失敗。 設定画面でシートIDを確認してください');
    } finally { setSyncingJobs(false); }
  };

  const syncInterviews = async () => {
    if (isDemo) { toast('デモ表示中は同期されません', { icon: 'ℹ' }); return; }
    setSyncingInterviews(true);
    try {
      const { data } = await api.post('/api/interviews/sync');
      const r = data.data || {};
      toast.success(`面接同期OK: 取込${r.kept ?? 0} / 新規${r.inserted ?? 0} / 更新${r.updated ?? 0}`);
      reload();
    } catch (e) {
      toast.error(e.userMessage || '面接同期失敗。 設定画面でシートIDを確認してください');
    } finally {
      setSyncingInterviews(false);
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
        const { data } = await api.get('/api/cpa/monthly', { params: { months: 12, basis } });
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
  }, [isDemo, reloadKey, basis]);

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

          {/* 集計基準トグル */}
          <div className="mt-3 inline-flex items-center gap-2 text-xs">
            <span className="text-zinc-500">月別集計の基準:</span>
            <div className="inline-flex rounded-md border border-zinc-300 overflow-hidden bg-white" role="tablist">
              <button
                type="button"
                onClick={() => setBasis('acquired')}
                className={[
                  'px-3 py-1.5 transition',
                  basis === 'acquired'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-zinc-600 hover:bg-zinc-50',
                ].join(' ')}
                title="シート BK列「案件取得日」を基準に月集計"
              >
                案件取得日 (BK列)
              </button>
              <button
                type="button"
                onClick={() => setBasis('offer')}
                className={[
                  'px-3 py-1.5 transition border-l border-zinc-300',
                  basis === 'offer'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-zinc-600 hover:bg-zinc-50',
                ].join(' ')}
                title="シート A列「内定日」を基準に月集計"
              >
                内定日 (A列)
              </button>
            </div>
          </div>
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
            title="『ビザ申請 進捗』シートから内定案件 (案件数/内定社数/初回入金/見込売上) を再同期"
          >
            {syncingProjects ? '売上同期中…' : '売上シート同期'}
          </button>
          <button
            onClick={syncJobs}
            disabled={syncingJobs}
            className="px-3 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
            title="『求人情報』シートから案件・バラシを再同期"
          >
            {syncingJobs ? '案件同期中…' : '案件シート同期'}
          </button>
          <button
            onClick={syncInterviews}
            disabled={syncingInterviews}
            className="px-3 py-2 text-sm bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-50"
            title="『2024_面接内訳』シートから面接記録を再同期"
          >
            {syncingInterviews ? '面接同期中…' : '面接シート同期'}
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
                    const onClickHandler = () => {
                      if (c.clickable === 'offers') {
                        setDetailMonth({
                          month: row.month,
                          monthLabel: formatMonth(row.month),
                          offersCount: Number(value),
                        });
                      } else if (c.clickable === 'interviews') {
                        setInterviewDetailMonth({
                          month: row.month,
                          monthLabel: formatMonth(row.month),
                          interviewsCount: Number(value),
                        });
                      } else if (c.clickable === 'projects') {
                        setJobsDetail({
                          month: row.month,
                          monthLabel: formatMonth(row.month),
                          filter: 'all',
                          expectedCount: Number(value),
                        });
                      } else if (c.clickable === 'cancels') {
                        setJobsDetail({
                          month: row.month,
                          monthLabel: formatMonth(row.month),
                          filter: 'cancelled',
                          expectedCount: Number(value),
                        });
                      }
                    };
                    const titleText = c.clickable === 'offers' ? '内定社の内訳を表示'
                                    : c.clickable === 'interviews' ? '面接の内訳を表示'
                                    : c.clickable === 'projects' ? '案件の内訳を表示'
                                    : c.clickable === 'cancels' ? 'バラシの内訳を表示' : '';
                    return (
                      <td key={c.key} className={cellClass}>
                        {isClickable ? (
                          <button
                            type="button"
                            onClick={onClickHandler}
                            className="text-indigo-600 hover:text-indigo-800 underline underline-offset-2 font-medium"
                            title={titleText}
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
        ※ 「案件数」「内定社数」「初回入金」「見込売上」は <strong>案件シート(『ビザ申請 進捗』)</strong> から同期されます。
        <br />
        　・<strong>案件数</strong> = FAX受電由来の全行(候補者単位、取消/辞退も含む)
        　・<strong>内定社数</strong> = 同一求人番号は1社にまとめてカウント(取消/辞退も含む)
        　・<strong>内定社数</strong> をクリックすると、その月の内訳(求人番号でグルーピング)が一覧表示されます
        　・<strong>初回入金 / 見込売上</strong> は取消/辞退の行を ¥0 として集計
        　・月キーは上部トグルで <strong>BK列「案件取得日」 ⇔ A列「内定日」</strong> を切り替え可能 (現在: <strong>{basis === 'offer' ? '内定日' : '案件取得日'}</strong>)
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
          basis={basis}
          onClose={() => setDetailMonth(null)}
        />
      )}

      {interviewDetailMonth && (
        <InterviewsDetailModal
          month={interviewDetailMonth.month}
          monthLabel={interviewDetailMonth.monthLabel}
          expectedCount={interviewDetailMonth.interviewsCount}
          basis={basis}
          onClose={() => setInterviewDetailMonth(null)}
        />
      )}

      {jobsDetail && (
        <JobPostingsDetailModal
          month={jobsDetail.month}
          monthLabel={jobsDetail.monthLabel}
          filter={jobsDetail.filter}
          expectedCount={jobsDetail.expectedCount}
          onClose={() => setJobsDetail(null)}
        />
      )}
    </div>
  );
}
