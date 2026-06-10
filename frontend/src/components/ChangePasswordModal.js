import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

export default function ChangePasswordModal({ onClose }) {
  const [current, setCurrent] = useState('');
  const [next1, setNext1] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const submit = async (e) => {
    e.preventDefault();
    if (!current || !next1) { toast.error('現在/新パスワードを入力'); return; }
    if (next1.length < 6) { toast.error('新パスワードは6文字以上'); return; }
    if (next1 !== next2) { toast.error('新パスワードが一致しません'); return; }
    setBusy(true);
    try {
      await api.put('/api/auth/me/password', { current_password: current, new_password: next1 });
      toast.success('パスワードを変更しました');
      onClose();
    } catch (err) { toast.error(err.userMessage || '変更失敗'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">パスワード変更</h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl">×</button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div>
            <label className="block text-xs text-zinc-600 mb-1">現在のパスワード</label>
            <input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)}
                   disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">新しいパスワード (6文字以上)</label>
            <input type="password" required value={next1} onChange={(e) => setNext1(e.target.value)}
                   disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">新しいパスワード (確認)</label>
            <input type="password" required value={next2} onChange={(e) => setNext2(e.target.value)}
                   disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded">キャンセル</button>
            <button type="submit" disabled={busy}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {busy ? '変更中…' : '変更'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
