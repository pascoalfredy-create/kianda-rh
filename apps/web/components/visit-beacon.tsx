'use client';
import { useEffect } from 'react';

/**
 * Conta a visita ao site público, uma vez por página aberta. Sem cookies nem armazenamento no navegador;
 * quem pede «não seguir» (Do Not Track / Global Privacy Control) não é contado.
 */
export function VisitBeacon() {
  useEffect(() => {
    try {
      const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
      if (nav.doNotTrack === '1' || nav.globalPrivacyControl) return;
      const source = new URLSearchParams(location.search).get('utm_source');
      void fetch('/api/v1/public/visit', {
        method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: location.pathname, referrer: document.referrer || null, source }),
      }).catch(() => {});
    } catch { /* a contagem nunca pode estragar a página */ }
  }, []);
  return null;
}
