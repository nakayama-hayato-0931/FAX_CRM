import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const MODE_OPTIONS = [
  {
    key: 'new',
    label: '新規リスト',
    description:
      '(1) NG/既存リスト と 会社名・電話・FAX のいずれかで一致 → スキップ / ' +
      '(2) 非NG の 電話 or FAX と一致 → 肉付けマージ (既存データを補完) / ' +
      '(3) 非NG で 会社名のみ 一致 または 完全未一致 → 新規登録 (同名別企業として OK)',
    badgeCls: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  },
  {
    key: 'existing',
    label: '既存リスト',
    description:
      '既に取引のある企業を 新規営業対象外 にします (NGリストとほぼ同じ扱い)。一致したら NG付与、未一致は NG付きで 新規登録。理由欄のデフォルトは「既存取引先」。',
    badgeCls: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  {
    key: 'ng',
    label: 'NGリスト',
    description:
      '配信停止依頼などを NG 登録します。一致した顧客を NG (ブラックリスト) に。一致しない行は NG付きで 新規登録。「NG理由」列があれば理由として保存。',
    badgeCls: 'bg-red-100 text-red-700 border-red-300',
  },
];

export default function CustomerCsvImportModal({ onClose, onCompleted, defaultMode = 'new' }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState(defaultMode);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);   // ファイル送信中
  const [progress, setProgress] = useState(null);      // backend job 進捗
  const [result, setResult] = useState(null);
  const pollRef = useRef(null);

  // 既存ジョブの自動レジューム: モーダル open 時に status を確認 → running のみ resume
  // done/failed はクリアして 新しいインポートを開始できるようにする
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await api.get('/api/customers/import/status');
        const job = data.data || {};
        if (!mounted) return;
        if (job.state === 'running') {
          setProgress(job);
          setBusy(true);
          startPolling();
        } else if (job.state === 'done' || job.state === 'failed') {
          // 過去ジョブが残っていてもクリアして fresh で始める (前回結果はトーストで通知済み)
          try { await api.delete('/api/customers/import/status'); } catch (_e) {}
        }
      } catch (_e) {}
    })();
    return () => {
      mounted = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 結果ペインから 「次のインポートへ」 = job 状態をクリアして フォームに戻す
  const resetForNext = async () => {
    try { await api.delete('/api/customers/import/status'); } catch (_e) {}
    setResult(null);
    setProgress(null);
    setBusy(false);
    setUploading(false);
    setFile(null);
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/api/customers/import/status');
        const job = data.data || {};
        setProgress(job);
        if (job.state === 'done') {
          stopPolling();
          setBusy(false);
          const r = job.result || {};
          setResult(r);
          const modeMeta = MODE_OPTIONS.find((m) => m.key === r.mode) || MODE_OPTIONS[0];
          if (r.mode === 'ng' || r.mode === 'existing') {
            toast.success(`${modeMeta.label} 取込: NG化 ${r.blacklisted || 0} / 新規(NG付) ${r.inserted || 0} / スキップ ${r.skipped || 0}`);
          } else {
            toast.success(`${modeMeta.label} 取込: 新規 ${r.inserted || 0} / 肉付け ${r.updated || 0} / スキップ ${r.skipped || 0}`);
          }
        } else if (job.state === 'failed') {
          stopPolling();
          setBusy(false);
          toast.error(`取込失敗: ${job.error?.message || 'unknown'}`);
        }
      } catch (_e) {}
    }, 3000);  // 3 秒ごとに polling
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { toast.error('ファイルを選択してください'); return; }
    setBusy(true); setUploading(true); setResult(null); setProgress(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      // 即時 202 (バックグラウンド処理開始) を受け取り、 polling で進捗を追う
      const { data } = await api.post('/api/customers/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30 * 60 * 1000,  // アップロード自体は 30分以内 (108MB なら数十秒)
      });
      setUploading(false);
      toast.success(`バックグラウンドで取込開始: ${data.data.jobId}`);
      startPolling();
    } catch (err) {
      setUploading(false);
      setBusy(false);
      toast.error(err.userMessage || 'アップロード失敗');
    }
  };

  const activeMode = MODE_OPTIONS.find((m) => m.key === mode) || MODE_OPTIONS[0];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">リストインポート (CSV / Excel)</h2>
          <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} disabled={busy}>×</button>
        </div>

        {/* バックグラウンド処理中の進捗表示 */}
        {!result && busy && progress && progress.state === 'running' && (
          <div className="bg-sky-50 border border-sky-200 rounded-md p-4 mb-4 text-sm">
            <div className="font-semibold text-sky-800 mb-2 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500 animate-pulse"></span>
              バックグラウンドで取込処理中… (job: {progress.id})
            </div>
            <div className="text-xs text-sky-700 mb-2">
              {progress.name} ({Math.round((progress.size || 0) / 1024 / 1024)}MB) / モード: {progress.mode}
            </div>
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-zinc-600">走査済み行数:</dt>
              <dd className="text-right tabular-nums">{(progress.progress?.totalRows || 0).toLocaleString()}</dd>
              <dt className="text-zinc-600">有効行数:</dt>
              <dd className="text-right tabular-nums">{(progress.progress?.validRows || 0).toLocaleString()}</dd>
              <dt className="text-zinc-600">新規追加:</dt>
              <dd className="text-right tabular-nums text-emerald-700">{(progress.progress?.inserted || 0).toLocaleString()}</dd>
              <dt className="text-zinc-600">肉付け / 更新:</dt>
              <dd className="text-right tabular-nums">{(progress.progress?.updated || 0).toLocaleString()}</dd>
              <dt className="text-zinc-600">スキップ:</dt>
              <dd className="text-right tabular-nums text-amber-600">{(progress.progress?.skipped || 0).toLocaleString()}</dd>
              {(progress.progress?.dupInFile || 0) > 0 && (
                <>
                  <dt className="text-zinc-600">ファイル内重複:</dt>
                  <dd className="text-right tabular-nums text-zinc-500">{progress.progress.dupInFile.toLocaleString()}</dd>
                </>
              )}
            </dl>
            <div className="mt-3 text-[11px] text-zinc-500">
              60万行クラスは 30〜60 分かかります。 このモーダルを閉じても処理は継続します。
              次回モーダルを開くと自動的に状況を表示します。
            </div>
          </div>
        )}

        {!result && !(busy && progress?.state === 'running') && (
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
              <div className="font-semibold text-zinc-700 mb-1">対応形式</div>
              <div className="text-[11px] mb-1.5">
                CSV (.csv) / Excel (.xls / .xlsx / .xlsm) — 1行目をヘッダとして自動マッピング。
                Urizo (売り蔵) / 法人名称形式 (全業界まとめ等) もそのまま取り込めます。
                .xlsx はストリーミング読み込みのため 60万行クラスの大規模ファイルにも対応 (最大 500MB)。
              </div>
              <div className="font-semibold text-zinc-700 mb-1 mt-2">対応列 (自動マッピング)</div>
              <code className="text-[11px] block">
                会社名 / 法人名称 / FAX / 電話番号 / 業種 / 業種(中分類1) / 都道府県 / 市区町村 / 住所 / 郵便番号 / URL / サイトURL / 従業員数 / 代表者(名) / 備考 / メモ / コメント / 法人サマリー
                {(mode === 'ng' || mode === 'existing') && ' / NG理由'}
              </code>
              <div className="text-[11px] mt-1 text-zinc-500">
                補助列 (メールアドレス / データ元 / 設立年月日 / 売上高 / 資本金 / 法人番号 / 法人種別 / 担当者名 / 職種 等) は備考欄に集約保存。
                〒付き郵便番号 / 「企業全体...68人」形式の従業員数 / 都道府県無し住所 も自動正規化。
              </div>
              <div className="mt-2 text-[11px]">
                {mode === 'new' && '会社名 必須。 電話/FAX は ハイフン無視 で照合。 同名別企業 (会社名のみ一致) は重複OKで新規登録。'}
                {mode === 'existing' && '会社名 必須。 会社名 / 電話 / FAX のいずれか1つでも既存と一致したら is_blacklisted=1 に。 未一致は 「既存取引先」 理由で新規 NG 登録。'}
                {mode === 'ng' && '会社名 必須。 会社名 / 電話 / FAX のいずれか1つでも既存と一致したら is_blacklisted=1 に。 未一致は NG 付きで新規登録。'}
              </div>
            </div>

            <input
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-zinc-300 rounded-md px-3 py-2 mb-4"
              disabled={busy}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md"
                      onClick={onClose} disabled={busy}>キャンセル</button>
              <button type="submit" className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50"
                      disabled={busy || !file}>
                {uploading ? 'アップロード中…' : busy ? '処理中…' : `${activeMode.label} として取込`}
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
                <dt className="text-zinc-600">{result.mode === 'new' ? '肉付け (空欄補完):' : '更新:'}</dt>
                <dd className="text-right tabular-nums">{result.updated.toLocaleString()}</dd>
                {(result.mode === 'ng' || result.mode === 'existing') && (
                  <>
                    <dt className="text-zinc-600">新規にNG化:</dt>
                    <dd className="text-right tabular-nums text-red-700 font-semibold">{result.blacklisted.toLocaleString()}</dd>
                  </>
                )}
                <dt className="text-zinc-600">スキップ:</dt>
                <dd className="text-right tabular-nums text-amber-600">{result.skipped.toLocaleString()}</dd>
                {result.dupInFile > 0 && (
                  <>
                    <dt className="text-zinc-600">ファイル内重複:</dt>
                    <dd className="text-right tabular-nums text-zinc-500">{result.dupInFile.toLocaleString()}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50" onClick={resetForNext}>
                次のインポートへ
              </button>
              <button className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700" onClick={async () => { await resetForNext(); onCompleted && onCompleted(); }}>
                閉じる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
