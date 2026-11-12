/**
 * Minimal pageview-only Yandex Metrica for the public landing document.
 * This module is imported ONLY by public-main.tsx, never by viewer.html.
 *
 * Consent is deliberately document-scoped, not stored. A new document
 * (including after revoke) starts without permission, even on the live host.
 */
export const COUNTER_ID = 114214620;
export const TAG_URL = 'https://mc.yandex.ru/metrika/tag.js?id=114214620';
export const PUBLIC_URL = 'https://neurometr.ru/';

type MetricaFunction = ((...args: unknown[]) => void) & {
  a?: unknown[][];
  l?: number;
};
declare global {
  interface Window {
    ym?: MetricaFunction;
  }
}

let initialized = false;

/** Never use a development, CI, preview or alternate-domain page for tracking. */
export function isTrackingAllowedLocation(loc: Pick<Location, 'protocol' | 'hostname' | 'port' | 'pathname'> = window.location): boolean {
  return loc.protocol === 'https:' && loc.hostname === 'neurometr.ru' &&
    loc.port === '' && loc.pathname === '/';
}

/** Strip inbound query/hash even before the user has granted consent. */
export function sanitizeLandingUrl(): void {
  if (window.location.pathname === '/' && (window.location.search || window.location.hash)) {
    window.history.replaceState(null, '', '/');
  }
}

/**
 * This must be called only as the direct result of the visitor clicking
 * "Разрешить аналитику". Never call on module import or automatically.
 * The first init records the one public pageview; no extra goals/hit events.
 */
export function enablePublicMetrica(): boolean {
  if (!isTrackingAllowedLocation() || initialized) return false;
  if (document.querySelector('script[data-neurometr-metrica]')) return false;

  // Public location must not contain query/hash when a third-party tag runs.
  sanitizeLandingUrl();
  initialized = true;

  const stub: MetricaFunction = (...args: unknown[]) => {
    if (!window.ym) return;
    (window.ym.a ??= []).push(args);
  };
  window.ym ??= stub;
  window.ym.l = Date.now();

  // No referrer, title, private DOM, goal parameters, ecommerce or user data.
  window.ym(COUNTER_ID, 'init', {
    url: PUBLIC_URL,
    referrer: '',
    sendTitle: false,
    webvisor: false,
    clickmap: false,
    trackLinks: false,
    trackHash: false,
    accurateTrackBounce: false,
    ecommerce: false,
    childIframe: false,
  });

  const script = document.createElement('script');
  script.dataset.neurometrMetrica = 'public-consented';
  script.src = TAG_URL;
  script.async = true;
  script.referrerPolicy = 'no-referrer';
  // An ad blocker or offline browser must not prevent the rest of the site.
  script.addEventListener('error', () => { /* intentional no-op */ });
  document.head.appendChild(script);
  return true;
}
