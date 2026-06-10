import '@/styles/globals.css';
import { Toaster } from 'react-hot-toast';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

function Shell({ Component, pageProps }) {
  const router = useRouter();
  const { loading, user } = useAuth();
  // /login はレイアウト無し
  if (router.pathname.startsWith('/login')) {
    return (
      <>
        <Component {...pageProps} />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#fff',
              color: '#18181b',
              border: '1px solid #e4e4e7',
              borderRadius: '8px',
              fontSize: '13px',
              padding: '10px 14px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            },
            success: {
              iconTheme: { primary: '#059669', secondary: '#fff' },
              style: { borderLeft: '3px solid #059669' },
            },
            error: {
              iconTheme: { primary: '#dc2626', secondary: '#fff' },
              style: { borderLeft: '3px solid #dc2626' },
            },
          }}
        />
      </>
    );
  }
  // 認証読み込み中はスケルトン
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-zinc-400 text-sm">
        読み込み中…
      </div>
    );
  }
  // 未ログイン → /login へ
  if (!user) {
    if (typeof window !== 'undefined') {
      const next = encodeURIComponent(router.asPath || '/');
      window.location.href = `/login?next=${next}`;
    }
    return null;
  }
  return (
    <Layout>
      <Component {...pageProps} />
      <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#fff',
              color: '#18181b',
              border: '1px solid #e4e4e7',
              borderRadius: '8px',
              fontSize: '13px',
              padding: '10px 14px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            },
            success: {
              iconTheme: { primary: '#059669', secondary: '#fff' },
              style: { borderLeft: '3px solid #059669' },
            },
            error: {
              iconTheme: { primary: '#dc2626', secondary: '#fff' },
              style: { borderLeft: '3px solid #dc2626' },
            },
          }}
        />
    </Layout>
  );
}

export default function App(props) {
  return (
    <AuthProvider>
      <Shell {...props} />
    </AuthProvider>
  );
}
