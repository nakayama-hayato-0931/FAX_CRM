import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

const NAV = [
  { href: '/', label: 'ホーム' },
  { href: '/customers', label: '顧客マスタ' },
  { href: '/lists', label: 'リスト抽出' },
  { href: '/manuscripts', label: '原稿管理' },
  { href: '/reports', label: '受電報告' },
  { href: '/fax-stats', label: 'FAX送信実績' },
  { href: '/cpa', label: 'CPA指標' },
  { href: '/settings', label: '設定' },
];

const FUTURE = [];

function isActive(pathname, href) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Layout({ children }) {
  const { pathname } = useRouter();
  return (
    <>
      <Head>
        <title>FAX-CRM</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="flex h-screen overflow-hidden">
        <aside className="w-56 flex-shrink-0 bg-white border-r border-zinc-200 flex flex-col">
          <div className="px-5 py-4 border-b border-zinc-200">
            <div className="text-base font-bold text-zinc-900 tracking-tight">FAX-CRM</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">Lead Management</div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-2 py-1">
              実装済み
            </div>
            {NAV.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={[
                    'block px-3 py-2 rounded-md text-sm transition',
                    active
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-zinc-700 hover:bg-zinc-50',
                  ].join(' ')}
                >
                  {n.label}
                </Link>
              );
            })}

            {FUTURE.length > 0 && (
              <>
                <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider px-2 pt-4 pb-1">
                  これから実装
                </div>
                {FUTURE.map((label) => (
                  <div
                    key={label}
                    className="px-3 py-2 text-sm text-zinc-400 cursor-not-allowed select-none"
                    title="未実装"
                  >
                    {label}
                  </div>
                ))}
              </>
            )}
          </nav>

          <div className="px-5 py-3 border-t border-zinc-200 text-[11px] text-zinc-400">
            v0.1.0
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-6 max-w-[1500px] mx-auto">{children}</div>
        </main>
      </div>
    </>
  );
}
