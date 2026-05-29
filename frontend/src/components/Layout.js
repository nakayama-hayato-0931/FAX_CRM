import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ChangePasswordModal from '@/components/ChangePasswordModal';

const NAV_ALL = [
  { href: '/', label: 'ホーム' },
  { href: '/customers', label: '顧客マスタ' },
  { href: '/lists', label: 'リスト抽出' },
  { href: '/scripts', label: '原稿管理' },
  { href: '/manuscripts', label: 'ドライブ格納' },
  { href: '/reports', label: '受電報告' },
  { href: '/fax-stats', label: 'FAX送信実績' },
  { href: '/cpa', label: 'CPA指標' },
  { href: '/settings', label: '設定' },
  { href: '/admin/users', label: 'ユーザー管理', adminOnly: true },
];

// 営業ロールが見える項目だけに絞る
const NAV_SALES_ALLOWED = new Set(['/reports']);

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Layout({ children }) {
  const { pathname } = useRouter();
  const { user, isAdmin, logout } = useAuth();
  const [showPwModal, setShowPwModal] = useState(false);

  const nav = NAV_ALL.filter((n) => {
    if (n.adminOnly && !isAdmin) return false;
    if (!isAdmin && !NAV_SALES_ALLOWED.has(n.href)) return false;
    return true;
  });

  return (
    <>
      <Head>
        <title>Hitokiwa-FAX-CRM-System</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="flex h-screen overflow-hidden">
        <aside className="w-56 flex-shrink-0 bg-white border-r border-zinc-200 flex flex-col">
          <div className="px-5 py-4 border-b border-zinc-200">
            <div className="text-[13px] font-bold text-zinc-900 tracking-tight leading-tight">Hitokiwa-FAX-CRM-System</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">FAX リードCRM</div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
            {nav.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link key={n.href} href={n.href}
                      className={[
                        'block px-3 py-2 rounded-md text-sm transition',
                        active ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-zinc-700 hover:bg-zinc-50',
                      ].join(' ')}>
                  {n.label}
                  {n.adminOnly && (
                    <span className="ml-1 text-[9px] text-amber-600 bg-amber-50 px-1 rounded align-middle">管理者</span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* ユーザー情報 + ログアウト */}
          <div className="px-3 py-3 border-t border-zinc-200">
            {user && (
              <div className="text-xs text-zinc-600 mb-2 px-2">
                <div className="font-medium text-zinc-800 truncate">
                  {user.display_name || user.username}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {user.role === 'admin' ? '管理者' : '営業'} ({user.username})
                </div>
              </div>
            )}
            <button onClick={() => setShowPwModal(true)}
                    className="w-full text-left text-xs text-zinc-600 hover:text-indigo-700 px-2 py-1 rounded">
              パスワード変更
            </button>
            <button onClick={logout}
                    className="w-full text-left text-xs text-zinc-600 hover:text-red-700 px-2 py-1 rounded">
              ログアウト
            </button>
            <div className="px-2 pt-2 text-[10px] text-zinc-400">v0.1.0</div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-6 max-w-[1500px] mx-auto">{children}</div>
        </main>
      </div>

      {showPwModal && (
        <ChangePasswordModal onClose={() => setShowPwModal(false)} />
      )}
    </>
  );
}
