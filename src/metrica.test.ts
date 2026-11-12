import { describe, expect, it } from 'vitest';
import { COUNTER_ID, PUBLIC_URL, TAG_URL, isTrackingAllowedLocation, enablePublicMetrica } from './metrica';

describe('Metrica page and consent gate', () => {
  it('uses only the approved counter and canonical public URL', () => {
    expect(COUNTER_ID).toBe(114214620);
    expect(TAG_URL).toBe('https://mc.yandex.ru/metrika/tag.js?id=114214620');
    expect(PUBLIC_URL).toBe('https://neurometr.ru/');
  });
  it('rejects localhost, HTTP, alternate hosts, ports and protected viewer', () => {
    const valid = { protocol: 'https:', hostname: 'neurometr.ru', port: '', pathname: '/' };
    expect(isTrackingAllowedLocation(valid)).toBe(true);
    for (const changes of [
      { protocol: 'http:' },
      { hostname: 'localhost' },
      { hostname: '127.0.0.1' },
      { hostname: 'www.neurometr.ru' },
      { hostname: 'evilneurometr.ru' },
      { hostname: 'neurometr.ru.evil.example' },
      { port: '444' },
      { pathname: '/viewer.html' },
      { pathname: '/app/' },
    ]) {
      expect(isTrackingAllowedLocation({ ...valid, ...changes })).toBe(false);
    }
  });
  it('does not initialize a tracker in jsdom/local development', () => {
    expect(enablePublicMetrica()).toBe(false);
    expect(document.querySelector('script[data-neurometr-metrica]')).toBeNull();
    expect(window.ym).toBeUndefined();
  });
});
