import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const { user, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // 既にログイン済みなら 遷移先 へ
  useEffect(() => {
    if (user) {
      const next = String(router.query.next || (user.role === 'sales' ? '/reports' : '/'));
      router.replace(next);
    }
  }, [user, router]);

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password) { toast.error('ユーザー名とパスワードを入力'); return; }
    setBusy(true);
    try {
      const u = await login(username.trim(), password);
      toast.success(`ようこそ ${u.display_name || u.username} さん`);
      const next = String(router.query.next || (u.role === 'sales' ? '/reports' : '/'));
      router.replace(next);
    } catch (err) {
      toast.error(err.userMessage || 'ログイン失敗');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="text-xl font-bold text-zinc-900">Hitokiwa-FAX-CRM</div>
          <div className="text-xs text-zinc-500 mt-1">ログイン</div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-600 mb-1">ユーザー名</label>
            <input type="text" required autoFocus value={username}
                   onChange={(e) => setUsername(e.target.value)}
                   disabled={busy}
                   className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-600 mb-1">パスワード</label>
            <input type="password" required value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   disabled={busy}
                   className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={busy}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md text-sm font-medium disabled:opacity-50">
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  );
}
