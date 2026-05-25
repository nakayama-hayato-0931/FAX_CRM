import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const MODE_OPTIONS = [
  {
    key: 'new',
    label: '新規リスト',
    description:
      '会社名 / 電話番号 / FAX番号 のいずれかで 既存顧客 (NG含む) と一致した行は スキップ。一致しない行のみ 新規登録します。',
    badgeCls: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  },
  {
    key: 'existing',
    label: '既存リスト',
    description:
      '既存顧客のデータを 肉付けマージ (空欄項目だけ CSV の値で埋める)。既存値は維持。一致しない行は スキップ (新規登録しない)。',
    badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  },
  {
    key: 'ng',
    label: 'NGリスト',
    description:
      '一致した顧客を NG (ブラックリスト) に。一致しない行は NG付きで 新規登録。「NG理由」列があれば理由として保存。',
    badgeCls: 'bg-red-100 text-red-700 border-red-300',
  },
];

export default function CustomerCsvImportModal({ onClose, onCompleted, defaultMode = 'new' }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState(defaultMode);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { toast.error('CSVファイルを選択してください'); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      const { data } = await api.post('/api/customers/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
      });
      setResult(data.data);
      const r = data.data;
      const modeMeta = MODE_OPTIONS.find((m) => m.key === r.mode) || MODE_OPTIONS[0];
      if (r.mode === 'ng') {
        toast.success(`${modeMeta.label} 取込: NG化 ${r.blacklisted} / 新規 ${r.inserted} / スキップ ${r.skipped}`);
      } else if (r.mode === 'existing') {
        toast.success(`${modeMeta.label} 取込: 更新 ${r.updated} / スキップ ${r.skipped}`);
      } else {
        toast.success(`${modeMeta.label} 取込: 新規 ${r.inserted} / 重複スキップ ${r.skipped}`);
      }
    } catch (err) {
      toast.error(err.userMessage || 'インポート失敗');
    } finally {
      setBusy(false);
    }
  };

  const activeMode = MODE_OPTIONS.find((m) => m.key === mode) || MODE_OPTIONS[0];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">顧客マスタ CSV インポート</h2>
          <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} disabled={busy}>×</button>
        </div>

        {!result && (
          <form onSubmit={submit}>
            {/* モード選択 */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-zinc-600 mb-2">取込モード</label>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {MODE_OPTIONS.map((m) => (
                  <button
                    type="button" key={m.key}
                    onClick={() => setMode(m.key)}
                    disabled={busy}
                    className={[
                      'text-sm py-2 rounded border transition',
                      mode === m.key
                        ? m.badgeCls + ' font-semibold'
                        : 'bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50',
                    ].join(' ')}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className={`text-xs leading-relaxed border rounded p-2.5 ${activeMode.badgeCls}`}>
                {activeMode.description}
              </div>
            </div>

            {/* 対応列の説明 */}
            <div className="text-xs text-zinc-500 leading-relaxed mb-3 bg-zinc-50 border border-zinc-200 rounded p-2.5">
              <div className="font-semibold text-zinc-700 mb-1">対応列 (自動マッピング)</div>
              <code className="text-[11px] block">
                会社名 / FAX / 電話番号 / 業種 / 都道府県 / 市区町村 / 住所 / 郵便番号 / URL / 従業員数 / 代表者 / 備考
                {mode === 'ng' && ' / NG理由'}
              </code>
              <div className="mt-1 text-[11px]">
                {mode === 'new' && '会社名 必須。 電話/FAX は ハイフン無視 で重複判定します。'}
                {mode === 'existing' && '会社名 / 電話 / FAX のいずれか 1つ で既存顧客を特定。'}
                {mode === 'ng' && '会社名 / 電話 / FAX のいずれか 1つ で既存顧客を特定、新規登録時は会社名 必須。'}
              </div>
            </div>

            <input
              type="file" accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-zinc-300 rounded-md px-3 py-2 mb-4"
              disabled={busy}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md"
                      onClick={onClose} disabled={busy}>キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                      disabled={busy || !file}>
                {busy ? 'アップロード中…' : `${activeMode.label} として取込`}
              </button>
            </div>
          </form>
        )}

        {result && (
          <div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-4 text-sm">
              <div className="font-semibold text-emerald-800 mb-2">
                {(MODE_OPTIONS.find((m) => m.key === result.mode) || MODE_OPTIONS[0]).label} 取込 完了
              </div>
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-zinc-600">読み込み行数:</dt>
                <dd className="text-right tabular-nums">{result.totalRows.toLocaleString()}</dd>
                <dt className="text-zinc-600">有効行数:</dt>
                <dd className="text-right tabular-nums">{result.validRows.toLocaleString()}</dd>
                <dt className="text-zinc-600">新規追加:</dt>
                <dd className="text-right tabular-nums text-emerald-700 font-semibold">{result.inserted.toLocaleString()}</dd>
                <dt className="text-zinc-600">更新:</dt>
                <dd className="text-right tabular-nums">{result.updated.toLocaleString()}</dd>
                {result.mode === 'ng' && (
                  <>
                    <dt className="text-zinc-600">新規にNG化:</dt>
                    <dd className="text-right tabular-nums text-red-700 font-semibold">{result.blacklisted.toLocaleString()}</dd>
                  </>
                )}
                <dt className="text-zinc-600">スキップ:</dt>
                <dd className="text-right tabular-nums text-amber-600">{result.skipped.toLocaleString()}</dd>
              </dl>
            </div>
            <div className="flex justify-end">
              <button className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md" onClick={onCompleted}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
