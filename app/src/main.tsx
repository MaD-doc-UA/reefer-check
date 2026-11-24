import { render } from 'preact';
import './index.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);

// launch splash (static markup in index.html): keep it for one full pulse of the checkmark (2.4 s, index.html), then fade out.
// On a slow cold start the Android system splash covers the page for seconds, so the 2.6 s since navigation can pass
// unseen: always keep it at least 1.8 s after the app is ready.
const splash = document.getElementById('splash');
if (splash) {
  const ready = performance.now();
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 700);
  }, Math.max(1800, 2600 - ready));
}

if (import.meta.env.DEV && location.hash.startsWith('#demo')) {
  import('./devDemo').then(m => m.loadDemo(location.hash.slice(6) || undefined)).catch(e => console.error('[demo]', e));
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
  });
}
