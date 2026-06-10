import { useEffect, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import ManuscriptContentPicker from './ManuscriptContentPicker';

const KIND_LABEL = {
  manuscript: { label: '原稿',       cls: 'bg-emerald-100 text-emerald-700' },
  excel:      { label: 'Excelリスト', cls: 'bg-emerald-100 text-emerald-700' },
  other:      { label: 'その他',     cls: 'bg-zinc-100 text-zinc-700' },
};

export default function ManuscriptSlotModal({ slot, onClose, onSaved, isDemo }) {
  const [form, setForm] = useState({
    title: slot.title || '',
    memo: slot.memo || '',
  });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(null); // kind or null ('manuscript' = attach in progress)
  const [showPicker, setShowPicker] = useState(false);
  const excelInputRef = useRef(null);

  // body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => { if (slot?.id) loadFiles(); /* eslint-disable-next-line */ }, [slot?.id]);

  async function loadFiles() {
    if (isDemo) { setFiles([]); return; }
    setLoadingFiles(true);
    try {
      const { data } = await api.get(`/api/manuscripts/slots/${slot.id}/files`);
      setFiles(data.data || []);
    } catch (_e) { /* ignore */ }
    finally { setLoadingFiles(false); }
  }

  async function uploadFile(kind, file) {
    if (isDemo) { toast('デモ表示中はアップロードできません'); return; }
    if (!file) return;
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      await api.post(`/api/manuscripts/slots/${slot.id}/files`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 5 * 60 * 1000,
      });
      toast.success(`${KIND_LABEL[kind]?.label || kind} をアップロードしました`);
      loadFiles();
    } catch (err) {
      toast.error(err.userMessage || 'アップロード失敗');
    } finally {
      setUploading(null);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  }

  // 原稿管理 から選択した原稿をスロットに紐づけ (Drive上でコピー)
  async function attachContent(content) {
    if (isDemo) { toast('デモ表示中は登録できません'); return; }
    if (!content?.id) return;
    setUploading('manuscript');
    try {
      await api.post(`/api/manuscripts/slots/${slot.id}/attach-content`, {
        manuscript_content_id: content.id,
      });
      toast.success(`原稿「${content.title || `#${content.id}`}」を紐づけました`);
      loadFiles();
    } catch (err) {
      toast.error(err.userMessage || '原稿の紐づけに失敗');
    } finally {
      setUploading(null);
    }
  }

  async function deleteFile(fileId) {
    if (isDemo) return;
    if (!window.confirm('このファイルを削除します。 (Drive上も削除されます) よろしいですか？')) return;
    try {
      await api.delete(`/api/manuscripts/slots/${slot.id}/files/${fileId}`);
      toast.success('削除しました');
      loadFiles();
    } catch (err) {
      toast.error(err.userMessage || '削除失敗');
    }
  }

  const save = async (e) => {
    e.preventDefault();
    if (isDemo) {
      toast('デモ表示中は保存できません');
      onSaved({ ...slot, ...form });
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/manuscripts/slots/${slot.id}`, form);
      toast.success('保存しました');
      onSaved({ ...slot, ...form });
    } catch (err) {
      toast.error(err.userMessage || '保存失敗');
    } finally {
      setBusy(false);
    }
  };

  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={save} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
            <h2 className="text-lg font-semibold text-zinc-900">
              {slot.folder_date} / スロット {slot.slot_number}
            </h2>
            <button type="button" className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} disabled={busy}>✕</button>
          </div>

          <div className="p-6 space-y-4 overflow-auto flex-1">
            <Field label="タイトル">
              <input type="text" value={form.title}
                     onChange={(e) => setForm({ ...form, title: e.target.value })}
                     className="ms-input" placeholder="例: 採用キャンペーン_製造業向け" />
            </Field>
            <Field label="メモ">
              <textarea value={form.memo} rows={3}
                        onChange={(e) => setForm({ ...form, memo: e.target.value })}
                        className="ms-input" />
            </Field>

            {/* ファイルアップロード */}
            <div className="bg-zinc-50 border border-zinc-200 rounded p-3">
              <div className="text-xs font-semibold text-zinc-700 mb-2">格納ファイル (Google Drive 共有ドライブ)</div>
              <div className="grid grid-cols-2 gap-2 mb-1">
                <button type="button"
                        disabled={!!uploading}
                        onClick={() => setShowPicker(true)}
                        className={`px-3 py-1.5 text-xs text-center rounded border ${
                          uploading === 'manuscript'
                            ? 'opacity-50 cursor-wait'
                            : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'}`}>
                  {uploading === 'manuscript' ? '紐づけ中…' : '+ 原稿を選択 (原稿管理から)'}
                </button>
                <label className={`px-3 py-1.5 text-xs text-center rounded border cursor-pointer ${
                  uploading === 'excel' ? 'opacity-50 cursor-wait' : 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'}`}>
                  {uploading === 'excel' ? 'アップロード中…' : '+ Excelリストを追加'}
                  <input ref={excelInputRef} type="file"
                         accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                         className="hidden"
                         disabled={!!uploading}
                         onChange={(e) => uploadFile('excel', e.target.files?.[0])} />
                </label>
              </div>
              <p className="text-[10px] text-zinc-500 mb-3">
                原稿は事前に <a href="/scripts" target="_blank" rel="noreferrer" className="text-emerald-700 underline">原稿管理</a> で登録した PDF から選択してください。
              </p>

              {loadingFiles && <div className="text-xs text-zinc-400 text-center py-2">読み込み中…</div>}
              {!loadingFiles && files.length === 0 && (
                <div className="text-xs text-zinc-400 text-center py-2">ファイルなし</div>
              )}
              {files.length > 0 && (
                <ul className="space-y-1">
                  {files.map((f) => {
                    const kindMeta = KIND_LABEL[f.kind] || KIND_LABEL.other;
                    return (
                      <li key={f.id} className="flex items-center gap-2 bg-white border border-zinc-200 rounded px-2 py-1.5 text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${kindMeta.cls}`}>{kindMeta.label}</span>
                        <div className="flex-1 min-w-0">
                          <a href={f.drive_url} target="_blank" rel="noreferrer"
                             className="text-emerald-700 hover:underline truncate block" title={f.original_name}>
                            {f.content_title || f.original_name}
                          </a>
                          {f.manuscript_content_id && (
                            <div className="text-[10px] text-zinc-500 truncate">
                              原稿管理 #{f.manuscript_content_id}
                              {f.content_registration_no && <span className="font-mono ml-1">({f.content_registration_no})</span>}
                            </div>
                          )}
                        </div>
                        <span className="text-zinc-400 text-[10px]">{fmtSize(f.size_bytes)}</span>
                        <button type="button" onClick={() => deleteFile(f.id)}
                                className="text-red-500 hover:underline text-[10px]">削除</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2 flex-shrink-0">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">キャンセル</button>
            <button type="submit" disabled={busy}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </form>

        <style jsx global>{`
          .ms-input { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 8px 12px; font-size: 14px; background: white; }
          .ms-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
        `}</style>
      </div>

      {showPicker && (
        <ManuscriptContentPicker
          onClose={() => setShowPicker(false)}
          onSelect={(content) => attachContent(content)}
          excludeContentIds={files.filter((f) => f.manuscript_content_id).map((f) => f.manuscript_content_id)}
        />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
