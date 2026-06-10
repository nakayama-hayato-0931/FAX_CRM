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
      <div className="flex h-screen overflow-hidden bg-zinc-50">
        <aside className="w-60 flex-shrink-0 bg-white border-r border-zinc-200 flex flex-col relative">
          {/* 上部 ブランドアクセント (深緑→緑のグラデーション) */}
          <div className="h-1 bg-gradient-to-r from-emerald-700 via-emerald-500 to-teal-400" />

          <div className="px-5 py-5">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-6 bg-gradient-to-b from-emerald-500 to-emerald-700 rounded-sm" />
              <div>
                <div className="text-[13px] font-bold text-zinc-900 tracking-tight leading-tight">Hitokiwa</div>
                <div className="text-[10px] text-emerald-700 font-medium tracking-widest uppercase mt-0.5">FAX CRM</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
            {nav.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link key={n.href} href={n.href}
                      className={[
                        'group relative flex items-center px-3 py-2 rounded-md text-sm transition-all duration-150',
                        active
                          ? 'bg-emerald-50 text-emerald-800 font-medium shadow-[inset_2px_0_0_0_theme(colors.emerald.600)]'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
                      ].join(' ')}>
                  <span className="flex-1">{n.label}</span>
                  {n.adminOnly && (
                    <span className="ml-2 text-[9px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">管理者</span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* ユーザー情報 + ログアウト */}
          <div className="px-3 py-3 border-t border-zinc-200 bg-zinc-50/50">
            {user && (
              <div className="text-xs text-zinc-600 mb-2 px-2">
                <div className="font-medium text-zinc-800 truncate">
                  {user.display_name || user.username}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  <span className={user.role === 'admin' ? 'text-amber-700' : 'text-emerald-700'}>
                    {user.role === 'admin' ? '管理者' : '営業'}
                  </span>
                  <span className="ml-1 text-zinc-400">({user.username})</span>
                </div>
              </div>
            )}
            <button onClick={() => setShowPwModal(true)}
                    className="w-full text-left text-xs text-zinc-600 hover:text-emerald-700 hover:bg-white px-2 py-1.5 rounded transition">
              パスワード変更
            </button>
            <button onClick={logout}
                    className="w-full text-left text-xs text-zinc-600 hover:text-rose-700 hover:bg-white px-2 py-1.5 rounded transition">
              ログアウト
            </button>
            <div className="px-2 pt-2 text-[10px] text-zinc-400">v0.1.0</div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          {/* max-width 制限を撤廃 — CPA/FAX送信実績 等 横長テーブル系で
              ワイドモニタの幅を活かせるように */}
          <div className="px-8 py-6">{children}</div>
        </main>
      </div>

      {showPwModal && (
        <ChangePasswordModal onClose={() => setShowPwModal(false)} />
      )}
    </>
  );
}
