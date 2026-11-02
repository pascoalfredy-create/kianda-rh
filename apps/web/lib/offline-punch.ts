'use client';

/**
 * Ponto sem rede: a marcação fica guardada no telemóvel (hora do aparelho + referência única) e é enviada quando a rede
 * voltar. O servidor marca estes registos como "offline" para a chefia validar.
 */
export interface QueuedPunch { ref: string; action: 'in' | 'out'; at: string; location?: { lat: number; lng: number; accuracy: number } | null; kiosk?: string }

const KEY = 'kianda_punch_queue';
const read = (): QueuedPunch[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedPunch[]; } catch { return []; } };
const write = (q: QueuedPunch[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* sem armazenamento */ } };

export const pendingPunches = read;

/** A posição (e o código do quiosque) ficam com a marcação: o servidor avalia-os com a hora da marcação. */
export function enqueuePunch(action: 'in' | 'out', extra: Pick<QueuedPunch, 'location' | 'kiosk'> = {}): QueuedPunch {
  const p: QueuedPunch = { ref: crypto.randomUUID(), action, at: new Date().toISOString(), ...(extra.location ? { location: extra.location } : {}), ...(extra.kiosk ? { kiosk: extra.kiosk } : {}) };
  write([...read(), p]);
  return p;
}

/** Envia por ordem. Pára no primeiro erro de rede; erros definitivos (4xx) saem da fila e são devolvidos. */
export async function flushPunches(): Promise<{ sent: number; rejected: { punch: QueuedPunch; message: string }[] }> {
  let sent = 0;
  const rejected: { punch: QueuedPunch; message: string }[] = [];
  for (const p of read()) {
    let res: Response;
    try {
      res = await fetch('/api/v1/attendance/clock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: p.action, at: p.at, clientRef: p.ref, ...(p.location ? { location: p.location } : {}), ...(p.kiosk ? { kiosk: p.kiosk } : {}) }) });
    } catch {
      break; // continua sem rede
    }
    if (res.status === 401 || res.status >= 500) break;
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      rejected.push({ punch: p, message: j.message ?? `Erro ${res.status}` });
    } else sent++;
    write(read().filter((x) => x.ref !== p.ref));
  }
  return { sent, rejected };
}

/** Falha de rede (fetch rejeitado ou navegador sem ligação). */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
