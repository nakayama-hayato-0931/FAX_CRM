import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

export default function FaxStatsImportModal({ onClose, onCompleted }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { toast.error('CSVファイルを選択してください'); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/api/fax-stats/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setResult(data.data);
      toast.success(`取込: 新規 ${data.data.inserted} / 更新 ${data.data.updated}`);
    } catch (err) {
      toast.error(err.userMessage || 'インポート失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">FAX送信実績 CSV インポート</h2>
          <button className="text-zinc-400 hover:text-zinc-600" onClick={onClose} disabled={busy}>✕</button>
        </div>

        {!result && (
          <form onSubmit={submit}>
            <div className="text-xs text-zinc-500 leading-relaxed mb-3">
              対応列:<br />
              <code className="text-[11px]">日付 / PC / 送信数 / 成功 / エラー / 話中 / 応答なし / 番号無効</code><br />
              <strong>日付 と PC は必須</strong>。(日付 × PC) で重複判定し、既存行は更新されます。
            </div>
            <input type="file" accept=".csv,text/csv"
                   onChange={(e) => setFile(e.target.files?.[0] || null)}
                   className="block w-full text-sm border border-zinc-300 rounded-md px-3 py-2 mb-4"
                   disabled={busy} />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md"
                      onClick={onClose} disabled={busy}>キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                      disabled={busy || !file}>
                {busy ? 'アップロード中…' : 'インポート実行'}
              </button>
            </div>
          </form>
        )}

        {result && (
          <div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-4 text-sm">
              <div className="font-semibold text-emerald-800 mb-2">取込完了</div>
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-zinc-600">読み込み行数:</dt>
                <dd className="text-right tabular-nums">{result.totalRows.toLocaleString()}</dd>
                <dt className="text-zinc-600">有効行数:</dt>
                <dd className="text-right tabular-nums">{result.validRows.toLocaleString()}</dd>
                <dt className="text-zinc-600">新規:</dt>
                <dd className="text-right tabular-nums text-emerald-700 font-semibold">{result.inserted.toLocaleString()}</dd>
                <dt className="text-zinc-600">更新:</dt>
                <dd className="text-right tabular-nums">{result.updated.toLocaleString()}</dd>
                <dt className="text-zinc-600">スキップ:</dt>
                <dd className="text-right tabular-nums text-amber-600">{result.skipped.toLocaleString()}</dd>
              </dl>
            </div>
            <div className="flex justify-end">
              <button className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md" onClick={onCompleted}>閉じる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
