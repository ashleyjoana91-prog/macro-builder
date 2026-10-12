import Head from 'next/head';
import { Plus_Jakarta_Sans } from 'next/font/google';
import '../styles/globals.css';

const font = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Macro Builder</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#F6F5F1" />
      </Head>
      <div className={font.className}>
        <Component {...pageProps} />
      </div>
    </>
  );
}
