import { useEffect, useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import ManuscriptContentPicker from './ManuscriptContentPicker';

/**
 * 23スロットを一覧表示し、各スロットに 原稿(PDF) / Excel リスト を割り当てて
 * 「一括アップロード」を押すと全スロットに対して順次 Drive アップロードする。
 *
 * Props:
 *   - date    : 'YYYY-MM-DD'
 *   - slots   : ManuscriptDatePage の slots 配列 (id, slot_number, title, drive_folder_id 等)
 *   - onClose : 閉じる
 *   - onCompleted : アップ完了で呼ばれる (任意)
 */
export default function BulkSlotUploadModal({ date, slots, onClose, onCompleted }) {
  // sel[slotId] = { manuscript: ContentObj|null, excel: File|null }
  //   manuscript は 原稿管理 から選んだ content オブジェクト (id, title, registration_no 等)
  //   excel は通常の File
  const [sel, setSel] = useState({});
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [pickerSlotId, setPickerSlotId] = useState(null);

  // body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC で閉じる (アップロード中はガード)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !uploading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, uploading]);

  const sortedSlots = useMemo(
    () => [...(slots || [])].sort((a, b) => a.slot_number - b.slot_number),
    [slots]
  );

  const setFile = (slotId, kind, value) => {
    setSel((prev) => ({
      ...prev,
      [slotId]: { ...(prev[slotId] || {}), [kind]: value || null },
    }));
  };

  const queue = useMemo(() => {
    const out = [];
    for (const s of sortedSlots) {
      const entry = sel[s.id] || {};
      if (entry.manuscript) out.push({ slot: s, kind: 'manuscript', content: entry.manuscript });
      if (entry.excel) out.push({ slot: s, kind: 'excel', file: entry.excel });
    }
    return out;
  }, [sortedSlots, sel]);

  const totalSelected = queue.length;
  const totalSlotsWithSelection = useMemo(
    () => new Set(queue.map((q) => q.slot.id)).size,
    [queue]
  );

  const runBulkUpload = async () => {
    if (!queue.length) {
      toast.error('原稿または Excel を1つ以上選択してください');
      return;
    }
    if (!window.confirm(
      `${totalSlotsWithSelection} スロット / 計 ${totalSelected} 件 (原稿 + Excel) を Drive に格納します。よろしいですか？`
    )) return;

    setUploading(true);
    setProgress({ done: 0, total: queue.length, errors: 0 });

    let done = 0, errors = 0;
    const CONCURRENCY = 3;

    // 単純な concurrency=3 で並行アップロード
    const tasks = [...queue];
    const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (tasks.length) {
        const task = tasks.shift();
        if (!task) break;
        try {
          if (task.kind === 'manuscript') {
            // 原稿管理から選択した原稿をスロットに紐づけ (Drive 上でコピー)
            await api.post(`/api/manuscripts/slots/${task.slot.id}/attach-content`, {
              manuscript_content_id: task.content.id,
            });
          } else {
            // Excel リスト等は従来通り直接アップロード
            const fd = new FormData();
            fd.append('file', task.file);
            fd.append('kind', task.kind);
            await api.post(`/api/manuscripts/slots/${task.slot.id}/files`, fd, {
              headers: { 'Content-Type': 'multipart/form-data' },
              timeout: 5 * 60 * 1000,
            });
          }
        } catch (err) {
          errors += 1;
          console.error(`[bulk-upload] slot ${task.slot.slot_number} (${task.kind}) failed:`, err);
        } finally {
          done += 1;
          setProgress({ done, total: queue.length, errors });
        }
      }
    });
    await Promise.all(workers);

    setUploading(false);
    if (errors === 0) {
      toast.success(`一斉格納が完了しました (${done}/${queue.length})`);
      onCompleted && onCompleted();
      onClose();
    } else {
      toast.error(`一部失敗: 成功 ${done - errors}/${queue.length} / エラー ${errors}`);
      onCompleted && onCompleted();
    }
  };

  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={() => !uploading && onClose()}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{date} / 一斉格納</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              各スロットの原稿は <a href="/scripts" target="_blank" rel="noreferrer" className="text-indigo-700 underline">原稿管理</a> から選択、
              Excelリストはファイルから選択。「一括アップロード」で全スロットの Drive 格納をまとめて実行します。
            </p>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 text-xl leading-none disabled:opacity-30"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 sticky top-0 z-10 border-b border-zinc-200">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-14">スロット</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">タイトル</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-64">原稿 (PDF)</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600 w-64">Excel リスト</th>
              </tr>
            </thead>
            <tbody>
              {sortedSlots.map((s) => {
                const entry = sel[s.id] || {};
                const hasDriveFolder = !!s.drive_folder_id;
                return (
                  <tr key={s.id} className="border-t border-zinc-100">
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                        {s.slot_number}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className={`text-sm ${s.title ? 'text-zinc-900' : 'text-zinc-400'}`}>
                        {s.title || '(未設定)'}
                      </div>
                      {!hasDriveFolder && (
                        <div className="text-[10px] text-amber-600 mt-1">
                          Drive フォルダ未作成: アップ時に自動作成されます
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <ContentSlot
                        content={entry.manuscript}
                        onPick={() => setPickerSlotId(s.id)}
                        onClear={() => setFile(s.id, 'manuscript', null)}
                        disabled={uploading}
                      />
                    </td>
                    <td className="px-3 py-2 align-top">
                      <FileSlot
                        kind="excel"
                        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                        file={entry.excel}
                        onPick={(f) => setFile(s.id, 'excel', f)}
                        disabled={uploading}
                        fmtSize={fmtSize}
                        colorClass="bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                        labelEmpty="+ Excel を選択"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-200 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="text-xs text-zinc-600">
            {uploading ? (
              <>
                アップロード中… <span className="font-bold text-zinc-900 tabular-nums">{progress.done}</span>
                {' / '}<span className="tabular-nums">{progress.total}</span>
                {progress.errors > 0 && (
                  <span className="text-red-600 ml-2">エラー {progress.errors}</span>
                )}
              </>
            ) : (
              <>
                選択中: <span className="font-bold text-zinc-900">{totalSlotsWithSelection}</span> スロット / 計
                <span className="font-bold text-zinc-900 ml-1">{totalSelected}</span> ファイル
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50 disabled:opacity-50"
            >
              {uploading ? '閉じる(完了後)' : 'キャンセル'}
            </button>
            <button
              type="button"
              onClick={runBulkUpload}
              disabled={uploading || !totalSelected}
              className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {uploading ? 'アップロード中…' : '一括アップロード'}
            </button>
          </div>
        </div>
      </div>

      {pickerSlotId && (
        <ManuscriptContentPicker
          onClose={() => setPickerSlotId(null)}
          onSelect={(content) => { setFile(pickerSlotId, 'manuscript', content); }}
          excludeContentIds={
            Object.values(sel)
              .map((e) => e?.manuscript?.id)
              .filter(Boolean)
          }
        />
      )}
    </div>
  );
}

function ContentSlot({ content, onPick, onClear, disabled }) {
  if (content) {
    return (
      <div className="flex items-center gap-2 border border-zinc-200 rounded bg-white px-2 py-1">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-700 truncate" title={content.title || `#${content.id}`}>
            {content.title || `原稿 #${content.id}`}
          </div>
          {content.registration_no && (
            <div className="text-[10px] text-zinc-500 font-mono">{content.registration_no}</div>
          )}
        </div>
        <button type="button" onClick={onClear} disabled={disabled}
                className="text-red-500 hover:underline text-[10px] disabled:opacity-50">解除</button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onPick} disabled={disabled}
            className={`block w-full px-3 py-1.5 text-xs text-center rounded border bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      + 原稿を選択 (原稿管理から)
    </button>
  );
}

function FileSlot({ kind, accept, file, onPick, disabled, fmtSize, colorClass, labelEmpty }) {
  if (file) {
    return (
      <div className="flex items-center gap-2 border border-zinc-200 rounded bg-white px-2 py-1">
        <span className="text-xs text-zinc-700 truncate flex-1" title={file.name}>{file.name}</span>
        <span className="text-[10px] text-zinc-400">{fmtSize(file.size)}</span>
        <button
          type="button"
          onClick={() => onPick(null)}
          disabled={disabled}
          className="text-red-500 hover:underline text-[10px] disabled:opacity-50"
        >
          解除
        </button>
      </div>
    );
  }
  return (
    <label className={`block px-3 py-1.5 text-xs text-center rounded border cursor-pointer ${colorClass} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      {labelEmpty}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] || null)}
      />
    </label>
  );
}
