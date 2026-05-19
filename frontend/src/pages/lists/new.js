import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const DEMO_INDUSTRIES = [
  { industry: '製造業', cnt: 152340 },
  { industry: '卸売業', cnt: 98221 },
  { industry: '情報通信', cnt: 47512 },
  { industry: '建設業', cnt: 63004 },
  { industry: '食料品製造', cnt: 19887 },
];
const DEMO_PREFECTURES = [
  { prefecture: '東京都', cnt: 312001 },
  { prefecture: '大阪府', cnt: 187220 },
  { prefecture: '愛知県', cnt: 94885 },
  { prefecture: '北海道', cnt: 76202 },
  { prefecture: '福岡県', cnt: 58991 },
];

export default function NewBatchPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';

  const [industries, setIndustries] = useState([]);
  const [prefectures, setPrefectures] = useState([]);

  const today = new Date();
  const defaultName = `バッチ_${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  const [form, setForm] = useState({
    name: defaultName,
    industry: '',
    prefecture: '',
    targetCount: 100,
    pcNumber: '',
    recentDays: 30,
  });

  const [previewCount, setPreviewCount] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // facet load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setIndustries(DEMO_INDUSTRIES);
        setPrefectures(DEMO_PREFECTURES);
        return;
      }
      try {
        const [ind, pref] = await Promise.all([
          api.get('/api/customers/facets/industries'),
          api.get('/api/customers/facets/prefectures'),
        ]);
        if (!cancelled) {
          setIndustries(ind.data.data || []);
          setPrefectures(pref.data.data || []);
        }
      } catch (_e) { /* silent: facets are optional */ }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

  const doPreview = async () => {
    setPreviewing(true); setPreviewCount(null);
    try {
      if (isDemo) {
        // 業種 × 都道府県 のだいたい1%を当該件数として返す簡易デモ
        const ind = DEMO_INDUSTRIES.find((i) => i.industry === form.industry);
        const pref = DEMO_PREFECTURES.find((p) => p.prefecture === form.prefecture);
        let cnt = 900000;
        if (ind) cnt = Math.min(cnt, ind.cnt);
        if (pref) cnt = Math.min(cnt, pref.cnt);
        cnt = Math.floor(cnt * 0.08);
        setPreviewCount(cnt);
        return;
      }
      const params = {
        industry: form.industry || undefined,
        prefecture: form.prefecture || undefined,
        recentDays: form.recentDays || undefined,
      };
      const { data } = await api.get('/api/batches/preview', { params });
      setPreviewCount(data.data.matchCount);
    } catch (e) {
      toast.error(e.userMessage || 'プレビュー失敗');
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.targetCount) {
      toast.error('バッチ名と件数は必須です');
      return;
    }
    if (isDemo) {
      toast('デモ表示中は抽出を実行できません', { icon: 'ℹ' });
      setResult({ batchId: 999, actualCount: Math.min(Number(form.targetCount), previewCount || Number(form.targetCount)), status: 'ready' });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        industry: form.industry || null,
        prefecture: form.prefecture || null,
        recentDays: Number(form.recentDays) || null,
        targetCount: Number(form.targetCount),
        pcNumber: form.pcNumber || null,
      };
      const { data } = await api.post('/api/batches', payload);
      setResult(data.data);
      toast.success(`抽出完了: ${data.data.actualCount} 件`);
    } catch (e) {
      toast.error(e.userMessage || '抽出失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadExcel = () => {
    if (isDemo) { toast('デモ表示中は実Excelダウンロードできません', { icon: 'ℹ' }); return; }
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001';
    window.open(`${base}/api/batches/${result.batchId}/excel`, '_blank');
  };

  if (result) {
    return (
      <div className="max-w-xl">
        <Link href={`/lists${isDemo ? '?demo=1' : ''}`} className="text-sm text-indigo-700 hover:underline">← リスト一覧へ</Link>
        <h1 className="text-2xl font-bold text-zinc-900 mt-3">抽出完了</h1>

        <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-lg p-5">
          <div className="text-xs text-emerald-700 font-medium">作成されたバッチ</div>
          <div className="mt-1 text-lg font-semibold text-emerald-900">{form.name}</div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-zinc-600">バッチID:</dt>
            <dd className="text-right tabular-nums">{result.batchId}</dd>
            <dt className="text-zinc-600">抽出件数:</dt>
            <dd className="text-right tabular-nums font-semibold">{result.actualCount.toLocaleString()}</dd>
            <dt className="text-zinc-600">ステータス:</dt>
            <dd className="text-right">{result.status}</dd>
          </dl>
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={downloadExcel}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            Excelダウンロード
          </button>
          <Link href={`/lists${isDemo ? '?demo=1' : ''}`}
                className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            リスト一覧に戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link href={`/lists${isDemo ? '?demo=1' : ''}`} className="text-sm text-indigo-700 hover:underline">← リスト一覧へ</Link>
      <h1 className="text-2xl font-bold text-zinc-900 mt-3">新規リスト抽出</h1>
      <p className="text-zinc-500 mt-1 text-sm">
        条件に合致する顧客を、送信回数の少ない順から指定件数だけ抽出します。
        {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
      </p>

      <form onSubmit={submit} className="mt-6 bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
        <Field label="バッチ名" required>
          <input type="text" className="input"
                 value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })}
                 required />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="業種">
            <select className="input"
                    value={form.industry}
                    onChange={(e) => { setForm({ ...form, industry: e.target.value }); setPreviewCount(null); }}>
              <option value="">(すべて)</option>
              {industries.map((i) => (
                <option key={i.industry} value={i.industry}>{i.industry} ({i.cnt.toLocaleString()})</option>
              ))}
            </select>
          </Field>
          <Field label="都道府県">
            <select className="input"
                    value={form.prefecture}
                    onChange={(e) => { setForm({ ...form, prefecture: e.target.value }); setPreviewCount(null); }}>
              <option value="">(すべて)</option>
              {prefectures.map((p) => (
                <option key={p.prefecture} value={p.prefecture}>{p.prefecture} ({p.cnt.toLocaleString()})</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="抽出件数" required>
            <input type="number" className="input" min="1" max="100000"
                   value={form.targetCount}
                   onChange={(e) => setForm({ ...form, targetCount: e.target.value })}
                   required />
          </Field>
          <Field label="PC番号">
            <input type="text" className="input" placeholder="例: PC03"
                   value={form.pcNumber}
                   onChange={(e) => setForm({ ...form, pcNumber: e.target.value })} />
          </Field>
          <Field label="N日以内送信を除外">
            <input type="number" className="input" min="0" max="365"
                   value={form.recentDays}
                   onChange={(e) => { setForm({ ...form, recentDays: e.target.value }); setPreviewCount(null); }} />
          </Field>
        </div>

        {/* Preview */}
        <div className="bg-zinc-50 border border-zinc-200 rounded-md p-3 flex items-center justify-between">
          <div className="text-sm text-zinc-700">
            {previewCount === null ? (
              <span className="text-zinc-500">条件に合致する件数を事前確認できます</span>
            ) : (
              <>該当件数: <span className="font-bold text-lg text-indigo-700 tabular-nums">{previewCount.toLocaleString()}</span> 件
                {form.targetCount > previewCount && (
                  <span className="ml-2 text-amber-700 text-xs">
                    ※ 指定件数({form.targetCount})が該当件数を超えています
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

        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/lists${isDemo ? '?demo=1' : ''}`}
                className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md">キャンセル</Link>
          <button type="submit" disabled={submitting}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? '抽出中…' : '抽出を実行'}
          </button>
        </div>
      </form>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 14px;
          background: white;
        }
        :global(.input:focus) {
          outline: 2px solid #6366f1;
          outline-offset: -1px;
          border-color: transparent;
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
