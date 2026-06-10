import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import { useRequireAuth } from '@/contexts/AuthContext';

export default function AdminUsersPage() {
  const { user, loading: authLoading } = useRequireAuth({ role: 'admin' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [pwTarget, setPwTarget] = useState(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/api/users');
        if (!cancelled) setItems(data.data || []);
      } catch (e) {
        if (!cancelled) toast.error(e.userMessage || '読み込み失敗');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, reloadKey]);

  const updateRole = async (u, newRole) => {
    if (!confirm(`「${u.username}」 のロールを ${newRole === 'admin' ? '管理者' : '営業'} に変更しますか？`)) return;
    try {
      await api.put(`/api/users/${u.id}`, { role: newRole });
      toast.success('ロールを変更しました');
      setReloadKey((k) => k + 1);
    } catch (e) { toast.error(e.userMessage || '変更失敗'); }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/api/users/${u.id}`, { is_active: !u.is_active });
      toast.success(u.is_active ? '無効化しました' : '有効化しました');
      setReloadKey((k) => k + 1);
    } catch (e) { toast.error(e.userMessage || '変更失敗'); }
  };

  const remove = async (u) => {
    if (!confirm(`ユーザー 「${u.username}」 を削除します。よろしいですか？`)) return;
    try {
      await api.delete(`/api/users/${u.id}`);
      toast.success('削除しました');
      setReloadKey((k) => k + 1);
    } catch (e) { toast.error(e.userMessage || '削除失敗'); }
  };

  if (authLoading || !user) return null;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">ユーザー管理</h1>
          <p className="text-zinc-500 mt-1 text-sm">管理者のみアクセス可。 ユーザーの追加 / ロール変更 / パスワードリセット / 無効化 / 削除。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setReloadKey((k) => k + 1)}
                  className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">再読み込み</button>
          <button onClick={() => setShowCreate(true)}
                  className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-md hover:bg-emerald-700">+ ユーザー追加</button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600">ユーザー名</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600">表示名</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600">ロール</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600">状態</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600">最終ログイン</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (<tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-400">読み込み中…</td></tr>)}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-400">ユーザーがありません</td></tr>
            )}
            {!loading && items.map((u) => (
              <tr key={u.id} className="border-t border-zinc-100">
                <td className="px-4 py-2.5 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-2.5">{u.display_name || <span className="text-zinc-300">—</span>}</td>
                <td className="px-4 py-2.5">
                  <select value={u.role} onChange={(e) => updateRole(u, e.target.value)}
                          disabled={u.id === user.id}
                          className="border border-zinc-300 rounded px-2 py-1 text-xs"
                          title={u.id === user.id ? '自分のロールは変更できません' : ''}>
                    <option value="sales">営業</option>
                    <option value="admin">管理者</option>
                  </select>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 text-[10px] rounded ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-600'}`}>
                    {u.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleString('ja-JP') : '—'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setPwTarget(u)}
                            className="px-2 py-1 text-xs bg-white border border-zinc-300 rounded hover:bg-zinc-50">
                      パスワード
                    </button>
                    {u.id !== user.id && (
                      <button onClick={() => toggleActive(u)}
                              className="px-2 py-1 text-xs bg-white border border-zinc-300 rounded hover:bg-zinc-50">
                        {u.is_active ? '無効化' : '有効化'}
                      </button>
                    )}
                    {u.id !== user.id && (
                      <button onClick={() => remove(u)}
                              className="px-2 py-1 text-xs bg-white border border-red-200 text-red-700 rounded hover:bg-red-50">
                        削除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCompleted={() => { setShowCreate(false); setReloadKey((k) => k + 1); }} />
      )}
      {pwTarget && (
        <ResetPasswordModal user={pwTarget} onClose={() => setPwTarget(null)} />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCompleted }) {
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'sales' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, busy]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('ユーザー名とパスワード必須'); return; }
    if (form.password.length < 6) { toast.error('パスワードは6文字以上'); return; }
    setBusy(true);
    try {
      await api.post('/api/users', form);
      toast.success(`ユーザー 「${form.username}」 を作成しました`);
      onCompleted();
    } catch (err) { toast.error(err.userMessage || '作成失敗'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">ユーザー追加</h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl">×</button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div>
            <label className="block text-xs text-zinc-600 mb-1">ユーザー名 *</label>
            <input type="text" required value={form.username}
                   onChange={(e) => setForm({ ...form, username: e.target.value })}
                   disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">パスワード * (6文字以上)</label>
            <input type="text" required value={form.password}
                   onChange={(e) => setForm({ ...form, password: e.target.value })}
                   disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">表示名 (任意)</label>
            <input type="text" value={form.display_name}
                   onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                   disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">ロール</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                    disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2">
              <option value="sales">営業 (受電報告のみ)</option>
              <option value="admin">管理者 (全機能 + ユーザー管理)</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={busy}
                    className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded">キャンセル</button>
            <button type="submit" disabled={busy}
                    className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              {busy ? '作成中…' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, busy]);
  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 6) { toast.error('6文字以上'); return; }
    setBusy(true);
    try {
      await api.put(`/api/users/${user.id}/password`, { new_password: pw });
      toast.success(`「${user.username}」 のパスワードを変更しました`);
      onClose();
    } catch (err) { toast.error(err.userMessage || '変更失敗'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900">パスワード再設定</h2>
          <button onClick={onClose} disabled={busy} className="text-zinc-400 hover:text-zinc-600 text-xl">×</button>
        </div>
        <p className="text-xs text-zinc-500 mb-3">対象: <span className="font-mono">{user.username}</span></p>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <input type="text" required value={pw} onChange={(e) => setPw(e.target.value)}
                 placeholder="新しいパスワード (6文字以上)"
                 disabled={busy} className="w-full border border-zinc-300 rounded-md px-3 py-2" />
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
