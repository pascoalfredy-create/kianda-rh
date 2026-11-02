'use client';


/**
 * Localização do telemóvel só no instante da marcação (nunca em contínuo). Sem permissão ou sem sinal devolve null:
 * a decisão (aceitar, assinalar ou recusar) é sempre do servidor, conforme a regra da empresa.
 */
export interface Fix { lat: number; lng: number; accuracy: number }
export function currentFix(timeoutMs = 12_000): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Fix | null) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs + 1000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      () => { clearTimeout(timer); finish(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }, // sempre uma posição nova: nunca a de uma marcação anterior
    );
  });
}

/** Leitura do QR do quiosque com a câmara, quando o navegador tem BarcodeDetector (Chrome/Android). */
export const canScanQr = () => typeof window !== 'undefined' && 'BarcodeDetector' in window;

export { describeLocation, mapLink } from './punch-location-text';
