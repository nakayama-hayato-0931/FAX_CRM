import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const DEMO_DATA = {
  settings: {
    drive_root_folder_id: { value: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', description: 'Drive上のルートフォルダID(リスト・原稿の親)' },
    drive_auto_upload:    { value: '1', description: 'リスト抽出時にExcelをDriveへ自動アップロード(1=ON)' },
    manuscript_auto_create_folders: { value: '0', description: '原稿日付登録時にDriveに23フォルダを自動作成(1=ON)' },
  },
  drive: {
    serviceAccount: { configured: true, keyPath: 'C:/secrets/sa.json', serviceAccount: 'fax-crm@example.iam.gserviceaccount.com' },
    driveReady: true,
    driveError: null,
  },
};

const DEMO_SHEETS_CFG = {
  sheet_id: '1dm7UEBA-OcOmgtCva2xJZkPYEDBx9lTW2k4GFrsxjZQ',
  sheet_range: 'A1:ZZ500',
  last_synced_at: '2026-05-15T08:00:00Z',
  last_sync_status: 'ok',
  last_sync_message: 'pivot / 56件 新規 / 14件 更新',
};

export default function SettingsPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ drive_root_folder_id: '', drive_auto_upload: '0', manuscript_auto_create_folders: '0', manuscript_pdf_drive_folder_id: '' });
  const [migratingPdfs, setMigratingPdfs] = useState(false);
  const [pdfMigrateResult, setPdfMigrateResult] = useState(null);
  const [sheetsForm, setSheetsForm] = useState({ sheet_id: '', sheet_range: 'A1:ZZ500' });
  const [sheetsCfg, setSheetsCfg] = useState(null);
  const [savingSheets, setSavingSheets] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  // 案件シート(『ビザ申請 進捗』)
  const [projectsForm, setProjectsForm] = useState({
    projects_sheet_id: '',
    projects_sheet_name: 'ビザ申請 進捗',
    projects_sheet_range: 'A1:CZ20000',
  });
  const [projectsCfg, setProjectsCfg] = useState(null);
  const [savingProjects, setSavingProjects] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState(false);
  const [projectsSyncResult, setProjectsSyncResult] = useState(null);
  // 求人情報シート (CPA 案件数 / バラシのソース)
  const [jobsForm, setJobsForm] = useState({
    jobs_sheet_id: '',
    jobs_sheet_name: '求人情報',
    jobs_sheet_range: 'A1:BZ20000',
  });
  const [jobsCfg, setJobsCfg] = useState(null);
  const [savingJobs, setSavingJobs] = useState(false);
  const [syncingJobs, setSyncingJobs] = useState(false);
  const [jobsSyncResult, setJobsSyncResult] = useState(null);
  // 面接シート(『2024_面接内訳』)
  const [interviewsForm, setInterviewsForm] = useState({
    interviews_sheet_id: '',
    interviews_sheet_name: '2024_面接内訳',
    interviews_sheet_range: 'A1:OZ20000',
  });
  const [interviewsCfg, setInterviewsCfg] = useState(null);
  const [savingInterviews, setSavingInterviews] = useState(false);
  const [syncingInterviews, setSyncingInterviews] = useState(false);
  const [interviewsSyncResult, setInterviewsSyncResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setData(DEMO_DATA);
        setForm({
          drive_root_folder_id: DEMO_DATA.settings.drive_root_folder_id.value || '',
          drive_auto_upload: DEMO_DATA.settings.drive_auto_upload.value || '0',
          manuscript_auto_create_folders: DEMO_DATA.settings.manuscript_auto_create_folders.value || '0',
        });
        setSheetsCfg(DEMO_SHEETS_CFG);
        setSheetsForm({ sheet_id: DEMO_SHEETS_CFG.sheet_id, sheet_range: DEMO_SHEETS_CFG.sheet_range });
        return;
      }
      setLoading(true);
      try {
        const [resSettings, resSheets, resProjects, resInterviews, resJobs] = await Promise.all([
          api.get('/api/settings'),
          api.get('/api/fax-stats/config').catch(() => ({ data: { data: null } })),
          api.get('/api/sales-projects/config').catch(() => ({ data: { data: null } })),
          api.get('/api/interviews/config').catch(() => ({ data: { data: null } })),
          api.get('/api/job-postings/config').catch(() => ({ data: { data: null } })),
        ]);
        if (cancelled) return;
        const d = resSettings.data.data || {};
        setData(d);
        setForm({
          drive_root_folder_id: d.settings?.drive_root_folder_id?.value || '',
          drive_auto_upload: d.settings?.drive_auto_upload?.value || '0',
          manuscript_auto_create_folders: d.settings?.manuscript_auto_create_folders?.value || '0',
          manuscript_pdf_drive_folder_id: d.settings?.manuscript_pdf_drive_folder_id?.value || '',
        });
        const sc = resSheets.data?.data;
        if (sc) {
          setSheetsCfg(sc);
          setSheetsForm({ sheet_id: sc.sheet_id || '', sheet_range: sc.sheet_range || 'A1:ZZ500' });
        }
        const pc = resProjects.data?.data;
        if (pc) {
          setProjectsCfg(pc);
          setProjectsForm({
            projects_sheet_id: pc.projects_sheet_id || '',
            projects_sheet_name: pc.projects_sheet_name || 'ビザ申請 進捗',
            projects_sheet_range: pc.projects_sheet_range || 'A1:CZ20000',
          });
        }
        const ic = resInterviews.data?.data;
        if (ic) {
          setInterviewsCfg(ic);
          setInterviewsForm({
            interviews_sheet_id: ic.interviews_sheet_id || '',
            interviews_sheet_name: ic.interviews_sheet_name || '2024_面接内訳',
            interviews_sheet_range: ic.interviews_sheet_range || 'A1:OZ20000',
          });
        }
        const jc = resJobs.data?.data;
        if (jc) {
          setJobsCfg(jc);
          setJobsForm({
            jobs_sheet_id: jc.jobs_sheet_id || '',
            jobs_sheet_name: jc.jobs_sheet_name || '求人情報',
            jobs_sheet_range: jc.jobs_sheet_range || 'A1:BZ20000',
          });
        }
      } catch (e) {
        if (!cancelled) toast.error(e.userMessage || '読み込み失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey]);

  const save = async () => {
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); return; }
    setSaving(true);
    try {
      await api.put('/api/settings', form);
      toast.success('設定を保存しました');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  const saveSheets = async () => {
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); return; }
    setSavingSheets(true);
    try {
      await api.put('/api/fax-stats/config', sheetsForm);
      toast.success('Sheets設定を保存しました');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally {
      setSavingSheets(false);
    }
  };

  const syncSheets = async () => {
    if (isDemo) {
      setSyncResult({ ok: true, format: 'pivot', totalRows: 70, validRows: 70, inserted: 56, updated: 14, skipped: 0 });
      toast.success('(デモ) 同期OK: 新規56件 / 更新14件');
      return;
    }
    setSyncing(true); setSyncResult(null);
    try {
      const { data: r } = await api.post('/api/fax-stats/sync');
      setSyncResult(r.data);
      toast.success(`同期: 新規${r.data.inserted} / 更新${r.data.updated} (${r.data.format})`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '同期失敗');
    } finally {
      setSyncing(false);
    }
  };

  const saveProjects = async () => {
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); return; }
    setSavingProjects(true);
    try {
      await api.put('/api/sales-projects/config', projectsForm);
      toast.success('案件シート設定を保存しました');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally {
      setSavingProjects(false);
    }
  };

  const syncProjects = async () => {
    if (isDemo) {
      setProjectsSyncResult({ totalRows: 4999, kept: 1407, inserted: 1400, updated: 7, skippedNotFax: 3508, skippedVisa: 74, skippedNoKey: 10 });
      toast.success('(デモ) 同期OK: 新規1400件 / 更新7件');
      return;
    }
    setSyncingProjects(true); setProjectsSyncResult(null);
    try {
      const { data: r } = await api.post('/api/sales-projects/sync');
      setProjectsSyncResult(r.data);
      toast.success(`案件同期: 新規${r.data.inserted} / 更新${r.data.updated}`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '同期失敗');
    } finally {
      setSyncingProjects(false);
    }
  };

  const saveJobs = async () => {
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); return; }
    setSavingJobs(true);
    try {
      await api.put('/api/job-postings/config', jobsForm);
      toast.success('求人シート設定を保存しました');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally { setSavingJobs(false); }
  };

  const syncJobs = async () => {
    if (isDemo) {
      setJobsSyncResult({ totalRows: 0, kept: 0, inserted: 0, updated: 0, cancelledCount: 0 });
      toast.success('(デモ) 同期OK'); return;
    }
    setSyncingJobs(true); setJobsSyncResult(null);
    try {
      const { data: r } = await api.post('/api/job-postings/sync');
      setJobsSyncResult(r.data);
      toast.success(`求人同期: 新規${r.data.inserted} / 更新${r.data.updated} (バラシ ${r.data.cancelledCount ?? 0})`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '同期失敗');
    } finally { setSyncingJobs(false); }
  };

  const saveInterviews = async () => {
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); return; }
    setSavingInterviews(true);
    try {
      await api.put('/api/interviews/config', interviewsForm);
      toast.success('面接シート設定を保存しました');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally {
      setSavingInterviews(false);
    }
  };

  const syncInterviews = async () => {
    if (isDemo) {
      setInterviewsSyncResult({ totalRows: 0, kept: 0, inserted: 0, updated: 0 });
      toast.success('(デモ) 同期OK');
      return;
    }
    setSyncingInterviews(true); setInterviewsSyncResult(null);
    try {
      const { data: r } = await api.post('/api/interviews/sync');
      setInterviewsSyncResult(r.data);
      toast.success(`面接同期: 新規${r.data.inserted} / 更新${r.data.updated}`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || '同期失敗');
    } finally {
      setSyncingInterviews(false);
    }
  };

  const migrateLocalPdfsToDrive = async () => {
    if (isDemo) { toast('デモ表示中は移行できません', { icon: 'ℹ' }); return; }
    if (!form.drive_root_folder_id && !form.manuscript_pdf_drive_folder_id) {
      toast.error('先に Drive ルートフォルダ ID か 原稿PDF Drive フォルダ ID を設定してください');
      return;
    }
    if (!window.confirm('既存のローカル保存 PDF を Google Drive に一括移行します。 進めますか？')) return;
    setMigratingPdfs(true); setPdfMigrateResult(null);
    try {
      const { data } = await api.post('/api/manuscript-contents/migrate-to-drive?limit=5000', null, { timeout: 30 * 60 * 1000 });
      setPdfMigrateResult(data.data);
      toast.success(`PDF移行: 対象${data.data.target} / 成功${data.data.uploaded} / エラー${data.data.errors} / 欠損${data.data.missing}`);
    } catch (e) {
      toast.error(e.userMessage || 'PDF移行失敗');
    } finally { setMigratingPdfs(false); }
  };

  const testConnection = async () => {
    if (isDemo) {
      setTestResult({ ok: true, sample: { id: 'demo123', name: 'demo-folder' } });
      toast.success('(デモ) 接続OK');
      return;
    }
    setTesting(true); setTestResult(null);
    try {
      const { data: r } = await api.post('/api/settings/drive/test');
      setTestResult(r.data);
      if (r.data.ok) toast.success('Drive接続OK');
      else toast.error('Drive接続失敗');
    } catch (e) {
      setTestResult({ ok: false, error: e.userMessage });
      toast.error(e.userMessage || 'テスト失敗');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div className="text-zinc-400 py-12 text-center">読み込み中…</div>;
  if (!data) return <div className="text-zinc-400 py-12 text-center">設定を取得できませんでした</div>;

  const sa = data.drive?.serviceAccount || {};

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">設定</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          Drive連携・自動化のON/OFF
          {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
        </p>
      </div>

      {/* Google認証状態 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-3">Google API 認証状態</h2>
        <dl className="text-sm grid grid-cols-[160px_1fr] gap-y-2">
          <dt className="text-zinc-500">サービスアカウント鍵</dt>
          <dd>
            {sa.configured
              ? <span className="text-emerald-700">✓ 設定済</span>
              : <span className="text-amber-700">未設定: {sa.reason}</span>}
          </dd>
          {sa.configured && (
            <>
              <dt className="text-zinc-500">鍵ファイルパス</dt>
              <dd className="font-mono text-xs break-all">{sa.keyPath}</dd>
              <dt className="text-zinc-500">サービスアカウント</dt>
              <dd className="font-mono text-xs break-all">{sa.serviceAccount || '—'}</dd>
            </>
          )}
          <dt className="text-zinc-500">Drive クライアント</dt>
          <dd>
            {data.drive?.driveReady
              ? <span className="text-emerald-700">✓ 利用可能</span>
              : <span className="text-red-700">利用不可: {data.drive?.driveError || '—'}</span>}
          </dd>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={testConnection} disabled={testing || !data.drive?.driveReady}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50">
            {testing ? 'テスト中…' : 'Drive接続テスト'}
          </button>
          {testResult && (
            <span className="text-xs">
              {testResult.ok
                ? <span className="text-emerald-700">✓ OK {testResult.sample ? `(サンプル: ${testResult.sample.name})` : ''}</span>
                : <span className="text-red-700">✗ {testResult.error}</span>}
            </span>
          )}
        </div>
        {!sa.configured && (
          <div className="mt-3 text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded p-3 leading-relaxed">
            設定方法: backend の <code>.env</code> に <code>GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/google-service-account.json</code> を追記し、GCP発行の鍵JSONを配置してbackendを再起動。
            鍵には Drive APIへのアクセス権 (<code>drive.file</code> スコープ) が必要。
          </div>
        )}
      </div>

      {/* Drive 設定 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-3">Drive 連携</h2>
        <div className="space-y-4">
          <Field label="ルートフォルダID" hint="Drive上の親フォルダ。配下に /YYYY-MM-DD/ サブフォルダを自動作成">
            <input type="text" value={form.drive_root_folder_id}
                   onChange={(e) => setForm({ ...form, drive_root_folder_id: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz..." />
          </Field>
          <Toggle label="リスト抽出 → Excel 自動Drive保存"
                  hint="ONにすると抽出ボタンの後に自動でアップロード。OFFなら手動「Drive保存」ボタンが必要"
                  checked={form.drive_auto_upload === '1'}
                  onChange={(v) => setForm({ ...form, drive_auto_upload: v ? '1' : '0' })} />
          <Toggle label="原稿日付登録 → 23フォルダ自動作成"
                  hint="ONにすると 2026/05/15/1〜23 のフォルダを自動作成。手動の場合は引き続きDrive URLを各スロットに入力"
                  checked={form.manuscript_auto_create_folders === '1'}
                  onChange={(v) => setForm({ ...form, manuscript_auto_create_folders: v ? '1' : '0' })} />

          <Field label="原稿PDF Drive フォルダID (任意)"
                 hint="新「原稿管理」 で PDF を保存する Drive フォルダ。 未設定なら 'ルートフォルダ/manuscripts' を自動作成">
            <input type="text" value={form.manuscript_pdf_drive_folder_id}
                   onChange={(e) => setForm({ ...form, manuscript_pdf_drive_folder_id: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="1XYZ..." />
          </Field>

          <div className="bg-zinc-50 border border-zinc-200 rounded p-3 text-xs">
            <div className="font-medium text-zinc-700 mb-1">原稿PDF を Drive に一括移行</div>
            <p className="text-zinc-500 leading-relaxed mb-2">
              ローカル <code>uploads/manuscripts/</code> に保存された既存の PDF を Drive に upload します。
              <strong> Railway デプロイで消える前に必ず移行</strong>してください。
            </p>
            <div className="flex items-center gap-2">
              <button onClick={migrateLocalPdfsToDrive} disabled={migratingPdfs}
                      className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
                {migratingPdfs ? '移行中…' : 'ローカル PDF を Drive に移行'}
              </button>
              {pdfMigrateResult && (
                <span className="text-xs text-emerald-700">
                  ✓ 対象 {pdfMigrateResult.target} / 成功 {pdfMigrateResult.uploaded} / エラー {pdfMigrateResult.errors} / 欠損 {pdfMigrateResult.missing}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 保存 */}
      <div className="flex justify-end gap-2 mb-6">
        <button onClick={() => setReloadKey((k) => k + 1)}
                className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md">再読込</button>
        <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
          {saving ? '保存中…' : '設定を保存'}
        </button>
      </div>

      {/* FAX送信実績 Sheets連携 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-1">FAX送信実績 Sheets 連携</h2>
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          Google スプレッドシートからFAX送信実績を取り込みます。
          <strong>ピボット形式</strong>(列=日付、行=NO.X セクション)に自動対応。
          「送信件数」「エラー数」のみ取り込み、「総数」「エラー総数」「送信数合計」は無視されます。
        </p>
        <div className="space-y-3">
          <Field label="スプレッドシートID" hint="URLの /d/ と /edit の間の文字列">
            <input type="text" value={sheetsForm.sheet_id}
                   onChange={(e) => setSheetsForm({ ...sheetsForm, sheet_id: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz..." />
          </Field>
          <Field label="読み取り範囲(A1記法)" hint="ピボット形式は日付列が広いため A1:ZZ500 程度を推奨">
            <input type="text" value={sheetsForm.sheet_range}
                   onChange={(e) => setSheetsForm({ ...sheetsForm, sheet_range: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="A1:ZZ500" />
          </Field>
        </div>

        {/* 状態表示 */}
        {sheetsCfg && (
          <div className="mt-4 bg-zinc-50 border border-zinc-200 rounded p-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-zinc-500">最終同期:</span>
              <span>{sheetsCfg.last_synced_at ? new Date(sheetsCfg.last_synced_at).toLocaleString('ja-JP') : '未実行'}</span>
              {sheetsCfg.last_sync_status && sheetsCfg.last_sync_status !== 'never' && (
                <span className={[
                  'px-1.5 py-0.5 rounded text-[10px]',
                  sheetsCfg.last_sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                ].join(' ')}>
                  {sheetsCfg.last_sync_status === 'ok' ? 'OK' : 'ERROR'}
                </span>
              )}
            </div>
            {sheetsCfg.last_sync_message && (
              <div className="mt-1 text-zinc-500 truncate">{sheetsCfg.last_sync_message}</div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button onClick={saveSheets} disabled={savingSheets}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50">
            {savingSheets ? '保存中…' : 'シート設定を保存'}
          </button>
          <button onClick={syncSheets} disabled={syncing || !sheetsForm.sheet_id}
                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            {syncing ? '同期中…' : '今すぐ同期'}
          </button>
          {syncResult && syncResult.ok !== false && (
            <span className="text-xs text-emerald-700">
              ✓ {syncResult.format || 'flat'} / 新規 {syncResult.inserted} / 更新 {syncResult.updated}
            </span>
          )}
        </div>
      </div>

      {/* 案件(『ビザ申請 進捗』) Sheets連携 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-1">案件シート連携 (『ビザ申請 進捗』)</h2>
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          案件シートから内定案件を取り込み、CPAの「案件数 / 初回入金 / 見込売上」に反映します。
          <br />
          抽出条件: <strong>BE列 = 「FAX受電」 AND J列 ≠ 「ビザ」</strong>。
          月集計の基準は BK列「案件取得日」。J列が「取消」「辞退」の行は金額0、案件数からも除外。
        </p>
        <div className="space-y-3">
          <Field label="スプレッドシートID" hint="URLの /d/ と /edit の間の文字列">
            <input type="text" value={projectsForm.projects_sheet_id}
                   onChange={(e) => setProjectsForm({ ...projectsForm, projects_sheet_id: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="1wPH1sud7dAwJQihiR6qDrH-otJ3ygAgcCAg-e4ituvw" />
          </Field>
          <Field label="シート(タブ)名" hint="既定: ビザ申請 進捗">
            <input type="text" value={projectsForm.projects_sheet_name}
                   onChange={(e) => setProjectsForm({ ...projectsForm, projects_sheet_name: e.target.value })}
                   className="rep-input text-xs"
                   placeholder="ビザ申請 進捗" />
          </Field>
          <Field label="読み取り範囲(A1記法)" hint="CF列(83)まで × 新規行追加に備えて A1:CZ20000 程度を推奨。 行数が足りないと最新エントリが切り捨てられます">
            <input type="text" value={projectsForm.projects_sheet_range}
                   onChange={(e) => setProjectsForm({ ...projectsForm, projects_sheet_range: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="A1:CZ20000" />
          </Field>
        </div>

        {/* 状態表示 */}
        {projectsCfg && (
          <div className="mt-4 bg-zinc-50 border border-zinc-200 rounded p-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-zinc-500">最終同期:</span>
              <span>{projectsCfg.projects_last_synced_at ? new Date(projectsCfg.projects_last_synced_at).toLocaleString('ja-JP') : '未実行'}</span>
              {projectsCfg.projects_last_sync_status && projectsCfg.projects_last_sync_status !== 'never' && (
                <span className={[
                  'px-1.5 py-0.5 rounded text-[10px]',
                  projectsCfg.projects_last_sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                ].join(' ')}>
                  {projectsCfg.projects_last_sync_status === 'ok' ? 'OK' : 'ERROR'}
                </span>
              )}
            </div>
            {projectsCfg.projects_last_sync_message && (
              <div className="mt-1 text-zinc-500 break-all">{projectsCfg.projects_last_sync_message}</div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button onClick={saveProjects} disabled={savingProjects}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50">
            {savingProjects ? '保存中…' : '案件シート設定を保存'}
          </button>
          <button onClick={syncProjects} disabled={syncingProjects || !projectsForm.projects_sheet_id}
                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            {syncingProjects ? '同期中…' : '今すぐ同期'}
          </button>
          {projectsSyncResult && (
            <span className="text-xs text-emerald-700">
              ✓ 取込 {projectsSyncResult.kept} / 新規 {projectsSyncResult.inserted} / 更新 {projectsSyncResult.updated}
              <span className="text-zinc-500 ml-2">
                (FAX以外 {projectsSyncResult.skippedNotFax} / ビザ {projectsSyncResult.skippedVisa} / キー無 {projectsSyncResult.skippedNoKey})
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 求人情報(『求人情報』) Sheets連携 — CPA 案件数 / バラシのソース */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-1">求人情報シート連携 (『求人情報』)</h2>
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          求人情報シートから案件・バラシを取り込み、CPAの「案件数」「バラシ」 に反映します。
          <br />
          抽出条件: <strong>H列 = 「FAX受電」</strong>。 月キーは AJ列「案件獲得日」。
          AI列 = 「バラシ」 の行は <strong>バラシ</strong> としてカウント。
          営業担当(B列) は「寺西 T」 のような末尾英字は自動除去。
        </p>
        <div className="space-y-3">
          <Field label="スプレッドシートID" hint="URLの /d/ と /edit の間の文字列 (売上シートと同じスプレッドシートでも可)">
            <input type="text" value={jobsForm.jobs_sheet_id}
                   onChange={(e) => setJobsForm({ ...jobsForm, jobs_sheet_id: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="1wPH1sud7dAwJQihiR6qDrH-otJ3ygAgcCAg-e4ituvw" />
          </Field>
          <Field label="シート(タブ)名" hint="既定: 求人情報">
            <input type="text" value={jobsForm.jobs_sheet_name}
                   onChange={(e) => setJobsForm({ ...jobsForm, jobs_sheet_name: e.target.value })}
                   className="rep-input text-xs"
                   placeholder="求人情報" />
          </Field>
          <Field label="読み取り範囲(A1記法)" hint="AJ列(35)まで読む必要あり。 A1:BZ20000 程度を推奨">
            <input type="text" value={jobsForm.jobs_sheet_range}
                   onChange={(e) => setJobsForm({ ...jobsForm, jobs_sheet_range: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="A1:BZ20000" />
          </Field>
        </div>

        {jobsCfg && (
          <div className="mt-4 bg-zinc-50 border border-zinc-200 rounded p-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-zinc-500">最終同期:</span>
              <span>{jobsCfg.jobs_last_synced_at ? new Date(jobsCfg.jobs_last_synced_at).toLocaleString('ja-JP') : '未実行'}</span>
              {jobsCfg.jobs_last_sync_status && jobsCfg.jobs_last_sync_status !== 'never' && (
                <span className={['px-1.5 py-0.5 rounded text-[10px]',
                  jobsCfg.jobs_last_sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'].join(' ')}>
                  {jobsCfg.jobs_last_sync_status === 'ok' ? 'OK' : 'ERROR'}
                </span>
              )}
            </div>
            {jobsCfg.jobs_last_sync_message && (
              <div className="mt-1 text-zinc-500 break-all">{jobsCfg.jobs_last_sync_message}</div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button onClick={saveJobs} disabled={savingJobs}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50">
            {savingJobs ? '保存中…' : '求人シート設定を保存'}
          </button>
          <button onClick={syncJobs} disabled={syncingJobs || !jobsForm.jobs_sheet_id}
                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            {syncingJobs ? '同期中…' : '今すぐ同期'}
          </button>
          {jobsSyncResult && (
            <span className="text-xs text-emerald-700">
              ✓ 取込 {jobsSyncResult.kept} / 新規 {jobsSyncResult.inserted} / 更新 {jobsSyncResult.updated}
              <span className="text-zinc-500 ml-2">
                (FAX以外 {jobsSyncResult.skippedNotFax} / キー無 {jobsSyncResult.skippedNoKey} / バラシ {jobsSyncResult.cancelledCount ?? 0})
              </span>
            </span>
          )}
        </div>
      </div>

      {/* 面接(『2024_面接内訳』) Sheets連携 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-zinc-800 mb-1">面接シート連携 (『2024_面接内訳』)</h2>
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          面接シートから面接記録を取り込み、CPAの「面接数」「面接CPA」「面接実施率」 に反映します。
          <br />
          抽出条件: <strong>NR列 = 「FAX受電」 AND NM列(面接日) ≦ 当日</strong>。
          月キーは「案件取得日(BK列)」基準のときは NS列、 「内定日(A列)」基準のときは NM列。
          面接数 = NP列(面接人数) の合計。
        </p>
        <div className="space-y-3">
          <Field label="スプレッドシートID" hint="URLの /d/ と /edit の間の文字列">
            <input type="text" value={interviewsForm.interviews_sheet_id}
                   onChange={(e) => setInterviewsForm({ ...interviewsForm, interviews_sheet_id: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="1gHldK7GyXpP9WoeMDi0E5KV6Ql4Xlw1J0_7BrV8U0tA" />
          </Field>
          <Field label="シート(タブ)名" hint="既定: 2024_面接内訳">
            <input type="text" value={interviewsForm.interviews_sheet_name}
                   onChange={(e) => setInterviewsForm({ ...interviewsForm, interviews_sheet_name: e.target.value })}
                   className="rep-input text-xs"
                   placeholder="2024_面接内訳" />
          </Field>
          <Field label="読み取り範囲(A1記法)" hint="NU列(384)まで読む必要あり。 A1:OZ20000 程度を推奨">
            <input type="text" value={interviewsForm.interviews_sheet_range}
                   onChange={(e) => setInterviewsForm({ ...interviewsForm, interviews_sheet_range: e.target.value })}
                   className="rep-input font-mono text-xs"
                   placeholder="A1:OZ20000" />
          </Field>
        </div>

        {interviewsCfg && (
          <div className="mt-4 bg-zinc-50 border border-zinc-200 rounded p-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-zinc-500">最終同期:</span>
              <span>{interviewsCfg.interviews_last_synced_at ? new Date(interviewsCfg.interviews_last_synced_at).toLocaleString('ja-JP') : '未実行'}</span>
              {interviewsCfg.interviews_last_sync_status && interviewsCfg.interviews_last_sync_status !== 'never' && (
                <span className={[
                  'px-1.5 py-0.5 rounded text-[10px]',
                  interviewsCfg.interviews_last_sync_status === 'ok' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
                ].join(' ')}>
                  {interviewsCfg.interviews_last_sync_status === 'ok' ? 'OK' : 'ERROR'}
                </span>
              )}
            </div>
            {interviewsCfg.interviews_last_sync_message && (
              <div className="mt-1 text-zinc-500 break-all">{interviewsCfg.interviews_last_sync_message}</div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button onClick={saveInterviews} disabled={savingInterviews}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50">
            {savingInterviews ? '保存中…' : '面接シート設定を保存'}
          </button>
          <button onClick={syncInterviews} disabled={syncingInterviews || !interviewsForm.interviews_sheet_id}
                  className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            {syncingInterviews ? '同期中…' : '今すぐ同期'}
          </button>
          {interviewsSyncResult && (
            <span className="text-xs text-emerald-700">
              ✓ 取込 {interviewsSyncResult.kept} / 新規 {interviewsSyncResult.inserted} / 更新 {interviewsSyncResult.updated}
              <span className="text-zinc-500 ml-2">
                (FAX以外 {interviewsSyncResult.skippedNotFax} / 未来or無日付 {interviewsSyncResult.skippedFutureOrNoDate} / キー無 {interviewsSyncResult.skippedNoKey})
              </span>
            </span>
          )}
        </div>
      </div>

      <style jsx global>{`
        .rep-input {
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          background: white;
        }
        .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
      `}</style>
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

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="text-xs font-medium text-zinc-700">{label}</div>
        {hint && <div className="text-[11px] text-zinc-500 mt-0.5">{hint}</div>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
              className={[
                'flex-shrink-0 relative inline-flex h-5 w-10 rounded-full transition mt-0.5',
                checked ? 'bg-indigo-600' : 'bg-zinc-300',
              ].join(' ')}>
        <span className={[
          'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')} />
      </button>
    </div>
  );
}
