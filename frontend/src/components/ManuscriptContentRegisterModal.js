import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const NATIONALITIES = ['ベトナム','ミャンマー','ネパール','モンゴル','スリランカ','バングラディシュ'];
const GENDERS = ['男','女'];
const INDUSTRIES = ['飲食','製造','小売','宿泊','建設','その他'];

export default function ManuscriptContentRegisterModal({ onClose, onCompleted }) {
  const [form, setForm] = useState({
    title: '', registration_no: '', nationality: '', gender: '', industry_category: '', memo: '',
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.registration_no && !form.title && !file) {
      toast.error('登録番号 / タイトル / PDF のいずれかは必須');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      if (file) fd.append('pdf', file);
      const { data } = await api.post('/api/manuscript-contents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      toast.success(`原稿を登録しました (ID: ${data.data?.id})`);
      onCompleted?.(data.data);
    } catch (err) {
      toast.error(err.userMessage || '登録失敗');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
            <h2 className="text-lg font-semibold text-zinc-900">原稿を登録</h2>
            <button type="button" className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} disabled={busy}>✕</button>
          </div>

          <div className="p-6 space-y-4">
            <Field label="PDF ファイル" hint="最大 30MB">
              <input type="file" accept="application/pdf"
                     onChange={(e) => setFile(e.target.files?.[0] || null)}
                     className="block w-full text-sm" />
              {file && <div className="mt-1 text-xs text-zinc-500">{file.name} ({Math.round(file.size / 1024)} KB)</div>}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="タイトル">
                <input type="text" value={form.title}
                       onChange={(e) => setForm({ ...form, title: e.target.value })}
                       className="rep-input" placeholder="例: 製造業向け_2026春" />
              </Field>
              <Field label="登録番号">
                <input type="text" value={form.registration_no}
                       onChange={(e) => setForm({ ...form, registration_no: e.target.value })}
                       className="rep-input font-mono" placeholder="例: QT4654" />
              </Field>

              <Field label="国籍">
                <select value={form.nationality}
                        onChange={(e) => setForm({ ...form, nationality: e.target.value })}
                        className="rep-input">
                  <option value="">選択しない</option>
                  {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>

              <Field label="性別">
                <select value={form.gender}
                        onChange={(e) => setForm({ ...form, gender: e.target.value })}
                        className="rep-input">
                  <option value="">選択しない</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>

              <Field label="業種カテゴリ">
                <select value={form.industry_category}
                        onChange={(e) => setForm({ ...form, industry_category: e.target.value })}
                        className="rep-input">
                  <option value="">選択しない</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
            </div>

            <Field label="メモ">
              <textarea rows={3} value={form.memo}
                        onChange={(e) => setForm({ ...form, memo: e.target.value })}
                        className="rep-input" placeholder="任意" />
            </Field>
          </div>

          <div className="px-6 py-3 border-t border-zinc-200 flex justify-end gap-2">
            <button type="button" onClick={onClose}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50"
                    disabled={busy}>キャンセル</button>
            <button type="submit" disabled={busy}
                    className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
              {busy ? '保存中…' : '登録'}
            </button>
          </div>
        </form>

        <style jsx global>{`
          .rep-input { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 6px 10px; font-size: 13px; background: white; }
          .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
        `}</style>
      </div>
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
