// Where the app runs: iPhone / iPad, browser tab or home-screen app.

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Opened from the home-screen icon (own window, no browser bars). */
export function isStandalone(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * iOS browser kind. 'inapp' = a page opened inside another app (Telegram, WhatsApp, mail...):
 * it has no Add to Home Screen, the page must go to Safari first.
 */
export function iosBrowser(): 'safari' | 'other' | 'inapp' {
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return 'other';
  if (/Safari\//.test(ua)) return 'safari';
  return 'inapp';
}
