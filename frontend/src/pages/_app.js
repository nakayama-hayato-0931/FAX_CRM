import '@/styles/globals.css';
import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

/**
 * グローバル: button (および checkbox/radio input) のクリック時に
 * ブラウザの auto-scroll (scrollIntoViewIfNeeded) が走るのを抑制する。
 *
 * Chrome は要素にフォーカスが当たった瞬間、 要素が viewport の中央付近に
 * 来るように親スクロール領域を微妙にスクロールする挙動がある。
 * fixed sidebar + main overflow:auto レイアウトと組み合わさると
 * 「ボタンをクリックしただけで画面が下にズレた」 という症状になる。
 *
 * mousedown を preventDefault するとブラウザは focus を当てない。
 * click イベントは引き続き発火するので、 onClick ハンドラ (state 更新や
 * form submit) は通常通り動く。 入力 (input text / textarea) には影響しない。
 *
 * キーボード操作 (Tab フォーカス) は preventDefault されないので
 * accessibility も維持される。
 */
function useSuppressFocusScroll() {
  useEffect(() => {
    function onMouseDown(e) {
      const t = e.target;
      if (!t || !t.tagName) return;
      // BUTTON (submit 含む) は mousedown で focus を奪わない
      // click イベントは通常通り発火するので onClick / form submit は問題なく動く
      if (t.tagName === 'BUTTON' || t.closest?.('button')) {
        e.preventDefault();
      }
      // input checkbox / radio は preventDefault すると checked toggle が阻害される
      // ブラウザがあるので 対象外。 必要なら個別ページで div+onClick に置き換える
    }
    // capture:true で他の listener より先に処理 (React の合成イベントは bubble phase)
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, []);
}

function Shell({ Component, pageProps }) {
  const router = useRouter();
  const { loading, user } = useAuth();
  useSuppressFocusScroll();
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
