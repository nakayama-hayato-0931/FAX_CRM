import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import BatchResultModal from '@/components/BatchResultModal';
import ManuscriptContentPicker from '@/components/ManuscriptContentPicker';

const DEMO_INDUSTRIES = [
  { industry: '飲食', cnt: 21917 },
  { industry: '製造', cnt: 60436 },
  { industry: '小売', cnt: 32888 },
  { industry: '宿泊', cnt: 9031 },
  { industry: '建設', cnt: 83826 },
  { industry: '農業', cnt: 4521 },
  { industry: '介護', cnt: 18234 },
  { industry: '運送', cnt: 12876 },
  { industry: 'その他', cnt: 71567 },
];
const DEMO_PREFECTURES = [
  { prefecture: '東京都', cnt: 312001 },
  { prefecture: '大阪府', cnt: 187220 },
  { prefecture: '愛知県', cnt: 94885 },
  { prefecture: '北海道', cnt: 76202 },
  { prefecture: '福岡県', cnt: 58991 },
];

const ALL_PCS = Array.from({ length: 23 }, (_, i) => i + 1);

// 8地域 → 構成都道府県 (リスト抽出 都道府県セレクタ用)
const REGION_GROUPS = [
  { region: '北海道', prefs: ['北海道'] },
  { region: '東北',   prefs: ['青森県','岩手県','宮城県','秋田県','山形県','福島県'] },
  { region: '関東',   prefs: ['茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県'] },
  { region: '中部',   prefs: ['新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県'] },
  { region: '近畿',   prefs: ['三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県'] },
  { region: '中国',   prefs: ['鳥取県','島根県','岡山県','広島県','山口県'] },
  { region: '四国',   prefs: ['徳島県','香川県','愛媛県','高知県'] },
  { region: '九州',   prefs: ['福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'] },
];

export default function NewBatchPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';

  const [industries, setIndustries] = useState([]);
  const [prefectures, setPrefectures] = useState([]);

  const today = new Date();
  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const [form, setForm] = useState({
    // バッチ名は createBatchesPerPc 側で `${name}_${date}_PC{nn}` に展開されるため、
    // デフォルト名には日付を入れない (二重に日付が並ぶのを防ぐ)
    name: 'リスト',
    date: todayYMD,
    industry: '',
    prefectures: [],          // [] = すべて / ['東京都', '神奈川県'] のように複数選択
    targetCount: 100,
    pcNumbers: [],            // [1, 3, 5...]
    recentDays: 30,
    recentCallDays: 0,        // N 日以内架電 除外 (0 = 除外しない)
    excludeProjects: true,    // 既存案件 (sales_projects/job_postings と社名一致) を除外
    testMode: false,          // テストモード: 顧客マスタの送信履歴を更新しない
    manuscript: null,         // { id, title, registration_no, ... } 選択中の原稿 (null=添付しない)
  });
  const [showManuscriptPicker, setShowManuscriptPicker] = useState(false);

  const [previewCount, setPreviewCount] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [missingPcs, setMissingPcs] = useState(null); // 未作成のスロットがあれば配列
  const [resultBatchId, setResultBatchId] = useState(null); // 結果モーダル表示中の batchId

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) { setIndustries(DEMO_INDUSTRIES); setPrefectures(DEMO_PREFECTURES); return; }
      try {
        const [ind, pref] = await Promise.all([
          api.get('/api/customers/facets/industries'),
          api.get('/api/customers/facets/prefectures'),
        ]);
        if (!cancelled) {
          setIndustries(ind.data.data || []);
          setPrefectures(pref.data.data || []);
        }
      } catch (_e) { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

  const togglePc = (pc) => {
    setForm((f) => ({
      ...f,
      pcNumbers: f.pcNumbers.includes(pc) ? f.pcNumbers.filter((x) => x !== pc) : [...f.pcNumbers, pc].sort((a, b) => a - b),
    }));
    setMissingPcs(null);
  };
  const selectAllPcs = () => {
    setForm((f) => ({ ...f, pcNumbers: [...ALL_PCS] }));
    setMissingPcs(null);
  };
  const clearAllPcs = () => {
    setForm((f) => ({ ...f, pcNumbers: [] }));
    setMissingPcs(null);
  };

  const doPreview = async () => {
    setPreviewing(true); setPreviewCount(null);
    try {
      if (isDemo) {
        const ind = DEMO_INDUSTRIES.find((i) => i.industry === form.industry);
        const pref = DEMO_PREFECTURES.find((p) => p.prefecture === form.prefecture);
        let cnt = 900000;
        if (ind) cnt = Math.min(cnt, ind.cnt);
        if (pref) cnt = Math.min(cnt, pref.cnt);
        setPreviewCount(Math.floor(cnt * 0.08));
        return;
      }
      const { data } = await api.get('/api/batches/preview', {
        params: {
          industry: form.industry || undefined,
          prefecture: form.prefectures?.length ? form.prefectures.join(',') : undefined,
          recentDays: form.recentDays || undefined,
          recentCallDays: form.recentCallDays || undefined,
          excludeProjects: form.excludeProjects ? 'true' : undefined,
        },
      });
      setPreviewCount(data.data.matchCount);
    } catch (e) { toast.error(e.userMessage || 'プレビュー失敗'); }
    finally { setPreviewing(false); }
  };

  // 抽出実行 (スロット存在チェック → 不足あればポップアップ → 一括抽出+upload)
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.targetCount) { toast.error('リスト名と件数は必須'); return; }
    if (!form.pcNumbers.length) { toast.error('PC番号を1つ以上選択してください'); return; }
    if (isDemo) {
      toast('デモ表示中は抽出を実行できません');
      setResult({
        date: form.date,
        results: form.pcNumbers.map((pc) => ({
          pcNumber: pc, batch: { batchId: 900 + pc, actualCount: Number(form.targetCount) },
          drive: { webViewLink: 'https://drive.google.com/...' },
        })),
      });
      return;
    }

    // 1. スロット存在チェック
    let missing = [];
    try {
      const { data } = await api.post('/api/batches/check-slots', {
        date: form.date, pcNumbers: form.pcNumbers,
      });
      missing = data.data?.missingPcs || [];
    } catch (err) {
      toast.error(err.userMessage || 'スロット確認失敗');
      return;
    }
    if (missing.length) {
      // ポップアップで確認
      const ok = window.confirm(
        `${form.date} のスロットが未作成です (不足: ${missing.length}個)。\n` +
        `1〜23 のスロットをまとめて作成しますか？\n\n` +
        `[OK] = 作成して抽出を進める\n[キャンセル] = 中止`
      );
      if (!ok) return;
      try {
        await api.post('/api/batches/ensure-slots', { date: form.date });
      } catch (err) { toast.error(err.userMessage || 'スロット作成失敗'); return; }
    }

    // 2. 抽出+upload を一括実行
    setSubmitting(true);
    try {
      const payload = {
        listName: form.name,
        date: form.date,
        industry: form.industry || null,
        prefecture: form.prefectures?.length ? form.prefectures.join(',') : null,
        recentDays: Number(form.recentDays) || null,
        recentCallDays: Number(form.recentCallDays) || 0,
        excludeProjects: !!form.excludeProjects,
        testMode: !!form.testMode,
        targetCount: Number(form.targetCount),
        pcNumbers: form.pcNumbers,
        manuscriptContentId: form.manuscript?.id || null,
      };
      const { data } = await api.post('/api/batches/extract-and-upload', payload, {
        timeout: 10 * 60 * 1000,
      });
      setResult(data.data);
      const okCount = data.data.results.filter((r) => !r.error).length;
      const errCount = data.data.results.filter((r) => r.error).length;
      toast.success(`抽出完了: 成功 ${okCount} / エラー ${errCount}`, { duration: 6000 });
    } catch (e) { toast.error(e.userMessage || '抽出失敗'); }
    finally { setSubmitting(false); }
  };

  // ----- 完了画面 -----
  if (result) {
    return (
      <div className="max-w-3xl">
        <Link href={`/lists${isDemo ? '?demo=1' : ''}`} className="text-sm text-emerald-700 hover:underline">← リスト一覧へ</Link>
        <h1 className="text-2xl font-bold text-zinc-900 mt-3">抽出完了</h1>
        <p className="text-zinc-500 text-sm mt-1">日付: {result.date} / 選択PC: {result.results.length}台</p>

        <div className="mt-6 space-y-2">
          {result.results.map((r) => (
            <div key={r.pcNumber}
                 className={`border rounded-lg p-4 ${r.error ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">PC {String(r.pcNumber).padStart(2, '0')}</div>
                  {r.batch && (
                    <div className="text-xs text-zinc-600 mt-0.5">
                      バッチID: {r.batch.batchId} / 抽出 {r.batch.actualCount} 件
                    </div>
                  )}
                  {r.drive?.manuscript && (
                    <div className="text-[11px] mt-1">
                      {r.drive.manuscript.attached && (
                        <span className="text-emerald-700">原稿格納OK{r.drive.manuscript.title ? ` (${r.drive.manuscript.title})` : ''}</span>
                      )}
                      {r.drive.manuscript.alreadyAttached && (
                        <span className="text-zinc-500">原稿は既にこのスロットに紐付け済み</span>
                      )}
                      {r.drive.manuscript.error && (
                        <span className="text-amber-700">原稿格納失敗: {r.drive.manuscript.error}</span>
                      )}
                    </div>
                  )}
                  {r.error && <div className="text-xs text-red-700 mt-1">{r.error}</div>}
                </div>
                <div className="flex gap-2">
                  {r.drive?.webViewLink && (
                    <a href={r.drive.webViewLink} target="_blank" rel="noreferrer"
                       className="px-3 py-1.5 text-xs bg-white border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100">
                      Drive で開く ↗
                    </a>
                  )}
                  {r.batch?.batchId && (
                    <button type="button"
                            onClick={() => setResultBatchId(r.batch.batchId)}
                            className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700">
                      結果
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <button onClick={() => { setResult(null); }} className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded">
            新しく抽出
          </button>
          <Link href={`/lists${isDemo ? '?demo=1' : ''}`} className="px-4 py-2 text-sm bg-zinc-700 text-white rounded">
            リスト一覧に戻る
          </Link>
        </div>

        {resultBatchId && (
          <BatchResultModal batchId={resultBatchId} onClose={() => setResultBatchId(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href={`/lists${isDemo ? '?demo=1' : ''}`} className="text-sm text-emerald-700 hover:underline">← リスト一覧へ</Link>
      <h1 className="text-2xl font-bold text-zinc-900 mt-3">新規リスト抽出</h1>
      <p className="text-zinc-500 mt-1 text-sm">
        「抽出件数 × PC台数」分の顧客を一括取得し、重複なく各 PC に分割して ドライブ格納の該当スロットに自動アップします。
        {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
      </p>

      <form onSubmit={submit} className="mt-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="リスト名 *">
            <input type="text" className="input"
                   value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })}
                   required />
          </Field>
          <Field label="日付 *" hint="ドライブ格納の YYYY-MM-DD フォルダに対応">
            <input type="date" className="input"
                   value={form.date}
                   onChange={(e) => { setForm({ ...form, date: e.target.value }); setMissingPcs(null); }}
                   required />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="業種">
            <select className="input"
                    value={form.industry}
                    onChange={(e) => { setForm({ ...form, industry: e.target.value }); setPreviewCount(null); }}>
              <option value="">(すべて)</option>
              {industries.map((i) => (
                <option key={i.industry} value={i.industry}>{i.industry} ({(i.cnt || 0).toLocaleString()})</option>
              ))}
            </select>
          </Field>
          <div className="block">
            <div className="flex items-center justify-between mb-1">
              <span className="block text-xs font-medium text-zinc-700">
                都道府県 ({form.prefectures.length === 0 ? 'すべて' : `${form.prefectures.length} 県選択中`})
              </span>
              {/* 全クリア は常にスロット確保 (選択0件時は invisible で見えないだけ → レイアウトずれ無し) */}
              <button type="button"
                      onClick={() => { setForm({ ...form, prefectures: [] }); setPreviewCount(null); }}
                      disabled={form.prefectures.length === 0}
                      className="text-[11px] text-zinc-500 hover:underline disabled:invisible">
                全クリア
              </button>
            </div>
            <span className="block text-[11px] text-zinc-500 mb-1.5">
              地域名をクリックで一括選択 / 県名チェックで個別選択。 0 = フィルタなし
            </span>
            <div className="border border-zinc-300 rounded-md bg-white max-h-56 overflow-auto p-2 space-y-1.5">
              {REGION_GROUPS.map((g) => {
                const allSelected = g.prefs.every((p) => form.prefectures.includes(p));
                const someSelected = g.prefs.some((p) => form.prefectures.includes(p));
                return (
                  <div key={g.region} className="flex items-start gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const set = new Set(form.prefectures);
                        if (allSelected) {
                          for (const p of g.prefs) set.delete(p);
                        } else {
                          for (const p of g.prefs) set.add(p);
                        }
                        setForm({ ...form, prefectures: [...set] });
                        setPreviewCount(null);
                      }}
                      className={[
                        'flex-shrink-0 text-[10px] w-12 py-0.5 rounded font-medium transition',
                        allSelected
                          ? 'bg-emerald-600 text-white'
                          : someSelected
                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                            : 'bg-white text-zinc-500 border border-zinc-300 hover:bg-zinc-50',
                      ].join(' ')}
                      title={`${g.region} を一括選択/解除`}
                    >
                      {g.region}
                    </button>
                    <div className="flex flex-wrap gap-0.5">
                      {g.prefs.map((p) => {
                        const checked = form.prefectures.includes(p);
                        return (
                          <label key={p}
                                 className={[
                                   'cursor-pointer text-[11px] px-1.5 py-0.5 rounded border transition select-none',
                                   checked
                                     ? 'bg-emerald-600 text-white border-emerald-600'
                                     : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50',
                                 ].join(' ')}>
                            <input type="checkbox" checked={checked}
                                   onChange={() => {
                                     const set = new Set(form.prefectures);
                                     if (checked) set.delete(p); else set.add(p);
                                     setForm({ ...form, prefectures: [...set] });
                                     setPreviewCount(null);
                                   }}
                                   className="sr-only" />
                            {p}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="抽出件数 (PCごと) *">
            <input type="number" className="input" min="1" max="100000"
                   value={form.targetCount}
                   onChange={(e) => setForm({ ...form, targetCount: e.target.value })}
                   required />
          </Field>
          <Field label="N日以内送信を除外" hint="last_sent_at が直近 N 日以内の顧客を除外">
            <input type="number" className="input" min="0" max="365"
                   value={form.recentDays}
                   onChange={(e) => { setForm({ ...form, recentDays: e.target.value }); setPreviewCount(null); }} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="N日以内架電を除外" hint="contact_events (channel=call) が直近 N 日以内の顧客を除外。 0 = 除外しない">
            <input type="number" className="input" min="0" max="365"
                   value={form.recentCallDays}
                   onChange={(e) => { setForm({ ...form, recentCallDays: e.target.value }); setPreviewCount(null); }} />
          </Field>
          <Field label="既存案件を除外" hint="案件マスタ (sales_projects / job_postings) と社名一致する顧客を除外">
            <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
              <input type="checkbox"
                     checked={form.excludeProjects}
                     onChange={(e) => { setForm({ ...form, excludeProjects: e.target.checked }); setPreviewCount(null); }}
                     className="w-4 h-4 text-emerald-600 rounded" />
              <span className="text-sm text-zinc-700">既に案件化済みの会社名を除外</span>
            </label>
          </Field>
        </div>

        {/* 原稿 同時格納 */}
        <Field label="原稿を同時にスロットへ格納 (任意)"
               hint="選択すると、 リスト Excel と同じ日付/PC のスロットフォルダに 原稿 PDF も自動コピーされます (既に紐付け済みならスキップ)">
          {form.manuscript ? (
            <div className="flex items-center justify-between gap-2 border border-emerald-200 bg-emerald-50 rounded-md px-3 py-2">
              <div className="text-sm min-w-0 flex-1">
                <div className="font-medium text-emerald-900 truncate">
                  {form.manuscript.title || `原稿 #${form.manuscript.id}`}
                </div>
                <div className="text-[11px] text-emerald-700/70 flex gap-2 flex-wrap mt-0.5">
                  {form.manuscript.registration_no && <span>登録番号: {form.manuscript.registration_no}</span>}
                  {form.manuscript.nationality && <span>国籍: {form.manuscript.nationality}</span>}
                  {form.manuscript.gender && <span>性別: {form.manuscript.gender}</span>}
                  {form.manuscript.industry_category && <span>業種: {form.manuscript.industry_category}</span>}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button type="button" onClick={() => setShowManuscriptPicker(true)}
                        className="px-2 py-1 text-xs bg-white border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-100">
                  変更
                </button>
                <button type="button" onClick={() => setForm({ ...form, manuscript: null })}
                        className="px-2 py-1 text-xs bg-white border border-zinc-300 text-zinc-600 rounded hover:bg-zinc-50">
                  解除
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowManuscriptPicker(true)}
                    className="w-full text-sm py-2.5 border border-dashed border-zinc-300 rounded-md text-zinc-600 hover:bg-zinc-50">
              + 原稿管理から選択
            </button>
          )}
        </Field>

        {/* テストモード */}
        <div className={[
          'border rounded-md p-3 transition',
          form.testMode ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 bg-zinc-50',
        ].join(' ')}>
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox"
                   checked={form.testMode}
                   onChange={(e) => setForm({ ...form, testMode: e.target.checked })}
                   className="w-4 h-4 text-amber-600 rounded mt-0.5" />
            <div>
              <div className="text-sm font-medium text-zinc-800">
                テストモード <span className="text-xs text-zinc-500">(顧客マスタに履歴を残さない)</span>
              </div>
              <div className="text-[11px] text-zinc-600 mt-0.5 leading-relaxed">
                送信回数 / 最終送信日時 / 最終PC を更新しません。 リスト/Excel/Drive は通常通り作成されるので動作確認に使えます。 バッチ名末尾に <code>_TEST</code> が付きます。
              </div>
            </div>
          </label>
        </div>

        {/* PC番号 チェックボックス */}
        <Field
          label={`PC番号 * (${form.pcNumbers.length} / 23 選択中)`}
          hint={`複数選択可。「抽出件数 × PC台数」 (= ${(Number(form.targetCount) || 0) * form.pcNumbers.length} 件) を一括取得して PC ごとに重複なく分割します`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex gap-2">
              <button type="button" onClick={selectAllPcs}
                      className="text-xs text-emerald-700 hover:underline">全選択</button>
              <button type="button" onClick={clearAllPcs}
                      className="text-xs text-zinc-500 hover:underline">クリア</button>
            </div>
          </div>
          <div className="grid grid-cols-12 gap-1.5">
            {ALL_PCS.map((pc) => {
              const checked = form.pcNumbers.includes(pc);
              return (
                <label key={pc}
                       className={[
                         'cursor-pointer text-center text-xs py-1.5 rounded border transition select-none',
                         checked ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50',
                       ].join(' ')}>
                  <input type="checkbox" checked={checked} onChange={() => togglePc(pc)} className="sr-only" />
                  {pc}
                </label>
              );
            })}
          </div>
        </Field>

        {/* Preview */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-md p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-zinc-700">
              {previewCount === null ? (
                <span className="text-zinc-500">FAX番号が登録されている顧客 × 業種/都道府県/N日以内除外 を満たす件数</span>
              ) : (
                <>該当件数 (FAX付き): <span className="font-bold text-lg text-emerald-700 tabular-nums">{previewCount.toLocaleString()}</span> 件
                  {form.pcNumbers.length > 0 && (
                    <span className="ml-2 text-xs text-zinc-500">
                      (合計予定 {(Number(form.targetCount) * form.pcNumbers.length).toLocaleString()} 件)
                    </span>
                  )}
                </>
              )}
            </div>
            <button type="button" onClick={doPreview} disabled={previewing}
                    className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-100 disabled:opacity-50">
              {previewing ? '集計中…' : '件数プレビュー'}
            </button>
          </div>
          {previewCount === 0 && (
            <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              <strong>FAX番号付きの顧客が0件です</strong>。 callcenter由来の顧客は phone のみ FAX未登録のため抽出対象外です。
              顧客マスタに FAX 付きの顧客を CSV インポート等で追加してください。
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/lists${isDemo ? '?demo=1' : ''}`}
                className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md">キャンセル</Link>
          <button type="submit" disabled={submitting || !form.pcNumbers.length}
                  className={[
                    'px-4 py-2 text-sm text-white rounded-md disabled:opacity-50',
                    form.testMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700',
                  ].join(' ')}>
            {submitting
              ? (form.testMode ? 'テスト抽出中…' : '抽出中…')
              : `${form.testMode ? 'テスト抽出' : '抽出'} → Drive 格納 (${form.pcNumbers.length}台)`}
          </button>
        </div>
      </form>

      {showManuscriptPicker && (
        <ManuscriptContentPicker
          onClose={() => setShowManuscriptPicker(false)}
          onSelect={(content) => {
            setForm({ ...form, manuscript: content });
            setShowManuscriptPicker(false);
          }}
        />
      )}

      <style jsx>{`
        :global(.input) { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 8px 12px; font-size: 14px; background: white; }
        :global(.input:focus) { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
      `}</style>
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {hint && <span className="block text-[11px] text-zinc-500 mb-1.5">{hint}</span>}
      {children}
    </label>
  );
}
