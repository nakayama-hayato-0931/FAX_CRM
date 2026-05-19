import '@/styles/globals.css';
import { Toaster } from 'react-hot-toast';
import Layout from '@/components/Layout';

export default function App({ Component, pageProps }) {
  return (
    <Layout>
      <Component {...pageProps} />
      <Toaster position="top-right" />
    </Layout>
  );
}
