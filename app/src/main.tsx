import { render } from 'preact';
import './index.css';
import { App } from './app';

render(<App />, document.getElementById('app')!);

if (import.meta.env.DEV && location.hash.startsWith('#demo')) {
  import('./devDemo').then(m => m.loadDemo(location.hash.slice(6) || undefined)).catch(e => console.error('[demo]', e));
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
  });
}
