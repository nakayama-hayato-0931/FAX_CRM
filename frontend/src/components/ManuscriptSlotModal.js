import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

export default function ManuscriptSlotModal({ slot, onClose, onSaved, isDemo }) {
  const [form, setForm] = useState({
    title: slot.title || '',
    drive_folder_url: slot.drive_folder_url || '',
    drive_folder_id: slot.drive_folder_id || '',
    thumbnail_url: slot.thumbnail_url || '',
    memo: slot.memo || '',
  });
  const [busy, setBusy] = useState(false);

  // body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (isDemo) {
      toast('デモ表示中は保存できません', { icon: 'ℹ' });
      onSaved({ ...slot, ...form });
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/manuscripts/slots/${slot.id}`, form);
      toast.success('保存しました');
      onSaved({ ...slot, ...form });
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()}
            onSubmit={save}
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">
            {slot.folder_date} / スロット {slot.slot_number}
          </h2>
          <button type="button" className="text-zinc-400 hover:text-zinc-600" onClick={onClose} disabled={busy}>✕</button>
        </div>

        <div className="space-y-3">
          <Field label="タイトル">
            <input type="text" className="ms-input"
                   value={form.title}
                   onChange={(e) => setForm({ ...form, title: e.target.value })}
                   placeholder="例: 採用キャンペーン_製造業向け" />
          </Field>

          <Field label="Drive フォルダ URL">
            <input type="url" className="ms-input"
                   value={form.drive_folder_url}
                   onChange={(e) => setForm({ ...form, drive_folder_url: e.target.value })}
                   placeholder="https://drive.google.com/drive/folders/..." />
          </Field>

          <Field label="Drive フォルダ ID (任意)">
            <input type="text" className="ms-input font-mono text-xs"
                   value={form.drive_folder_id}
                   onChange={(e) => setForm({ ...form, drive_folder_id: e.target.value })}
                   placeholder="Drive APIの folderId" />
          </Field>

          <Field label="サムネイル URL (任意)">
            <input type="url" className="ms-input"
                   value={form.thumbnail_url}
                   onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} />
          </Field>

          <Field label="メモ">
            <textarea className="ms-input min-h-[80px]"
                      value={form.memo}
                      onChange={(e) => setForm({ ...form, memo: e.target.value })} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button"
                  className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md"
                  onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="submit"
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      <style jsx global>{`
        .ms-input {
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 14px;
          background: white;
        }
        .ms-input:focus {
          outline: 2px solid #6366f1;
          outline-offset: -1px;
          border-color: transparent;
        }
      `}</style>
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
