import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ChangePasswordModal from '@/components/ChangePasswordModal';

// SVG アイコン (heroicons outline 系 / stroke-1.5)
//   絵文字を使わない方針なので inline SVG。 currentColor で色を継承
const Icon = ({ path, className = 'w-4 h-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
       className={className}>
    {path}
  </svg>
);
const ICONS = {
  home:        <><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></>,
  users:       <><circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" /></>,
  filter:      <><path d="M3 6h18" /><path d="M6 12h12" /><path d="M10 18h4" /></>,
  document:    <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8" /><path d="M8 17h8" /></>,
  folder:      <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  phone:       <><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.71 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.71A2 2 0 0 1 22 16.92z" /></>,
  chartBar:    <><path d="M3 20V10" /><path d="M9 20V4" /><path d="M15 20v-7" /><path d="M21 20v-4" /></>,
  chartPie:    <><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>,
  cog:         <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  shield:      <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
};

const NAV_GROUPS = [
  {
    title: 'メイン',
    items: [
      { href: '/', label: 'ホーム', icon: ICONS.home },
    ],
  },
  {
    title: '集客運用',
    items: [
      { href: '/customers', label: '顧客マスタ', icon: ICONS.users },
      { href: '/lists',     label: 'リスト抽出', icon: ICONS.filter },
    ],
  },
  {
    title: '原稿',
    items: [
      { href: '/scripts',     label: '原稿管理',     icon: ICONS.document },
      { href: '/manuscripts', label: 'ドライブ格納', icon: ICONS.folder },
    ],
  },
  {
    title: '配信 / 受電',
    items: [
      { href: '/fax-stats', label: 'FAX送信実績', icon: ICONS.chartBar },
      { href: '/reports',   label: '受電報告',    icon: ICONS.phone },
    ],
  },
  {
    title: '分析',
    items: [
      { href: '/cpa', label: 'CPA指標', icon: ICONS.chartPie },
    ],
  },
  {
    title: '管理',
    items: [
      { href: '/settings',    label: '設定',         icon: ICONS.cog },
      { href: '/admin/users', label: 'ユーザー管理', icon: ICONS.shield, adminOnly: true },
    ],
  },
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

  // 表示可否のフィルタを各 group の items にかけ、 残った items が 0 なら group ごと非表示
  const visibleGroups = NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((n) => {
        if (n.adminOnly && !isAdmin) return false;
        if (!isAdmin && !NAV_SALES_ALLOWED.has(n.href)) return false;
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  const userInitial = (user?.display_name || user?.username || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <Head>
        <title>Hitokiwa-FAX-CRM-System</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="flex h-screen overflow-hidden bg-zinc-50">
        {/* ダーク基調の sidebar — 黒→緑のグラデーションで深みを出す */}
        <aside className="w-60 flex-shrink-0 flex flex-col text-zinc-200
                          bg-gradient-to-b from-black via-slate-950 to-emerald-950
                          border-r border-slate-800/70">
          {/* 上部 ブランドヘッダ — ロゴなし テキストのみ */}
          <div className="px-5 pt-6 pb-5 border-b border-white/5">
            <div className="leading-tight">
              <div className="text-[15px] font-bold text-white tracking-tight">Hitokiwa</div>
              <div className="text-[9.5px] text-emerald-400 font-semibold tracking-[0.22em] uppercase mt-1">FAX CRM</div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4 custom-scrollbar">
            {visibleGroups.map((g) => (
              <div key={g.title}>
                <div className="px-2.5 mb-1.5 text-[9.5px] font-semibold text-slate-500 tracking-[0.18em] uppercase">
                  {g.title}
                </div>
                <div className="space-y-0.5">
                  {g.items.map((n) => {
                    const active = isActive(pathname, n.href);
                    return (
                      <Link key={n.href} href={n.href}
                            className={[
                              'group relative flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-md text-[13px] transition-all duration-150',
                              active
                                ? 'bg-gradient-to-r from-emerald-600/20 to-emerald-600/5 text-white font-medium'
                                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
                            ].join(' ')}>
                        {active && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-gradient-to-b from-emerald-400 to-emerald-600" />
                        )}
                        <span className={[
                          'flex-shrink-0 transition-colors',
                          active ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300',
                        ].join(' ')}>
                          <Icon path={n.icon} />
                        </span>
                        <span className="flex-1 truncate">{n.label}</span>
                        {n.adminOnly && (
                          <span className="text-[8.5px] text-amber-400/90 bg-amber-400/10 border border-amber-400/30 px-1.5 py-0.5 rounded">ADMIN</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* ユーザー情報 + アクション */}
          <div className="px-2.5 py-3 border-t border-slate-800/80">
            {user && (
              <div className="flex items-center gap-2.5 px-2 pb-2.5">
                <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white text-[12px] font-bold shadow shadow-emerald-900/50">
                  {userInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-slate-100 truncate">
                    {user.display_name || user.username}
                  </div>
                  <div className="text-[9.5px] mt-0.5">
                    <span className={[
                      'inline-block px-1.5 py-0.5 rounded',
                      user.role === 'admin'
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
                    ].join(' ')}>
                      {user.role === 'admin' ? '管理者' : '営業'}
                    </span>
                    <span className="ml-1.5 text-slate-500">{user.username}</span>
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-1 px-1">
              <button onClick={() => setShowPwModal(true)}
                      title="パスワード変更"
                      className="flex-1 text-center text-[10.5px] text-slate-400 hover:text-emerald-300 hover:bg-slate-800/60 px-2 py-1.5 rounded transition">
                パスワード
              </button>
              <button onClick={logout}
                      title="ログアウト"
                      className="flex-1 text-center text-[10.5px] text-slate-400 hover:text-rose-300 hover:bg-slate-800/60 px-2 py-1.5 rounded transition">
                ログアウト
              </button>
            </div>
            <div className="text-center pt-2 text-[9px] text-slate-600 tracking-widest">v0.1.0</div>
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
