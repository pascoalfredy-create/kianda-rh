'use client';

/**
 * Ponto sem rede: a marcação fica guardada no telemóvel (hora do aparelho + referência única) e é enviada quando a rede
 * voltar. O servidor marca estes registos como "offline" para a chefia validar.
 */
export interface QueuedPunch { ref: string; action: 'in' | 'out'; at: string }

const KEY = 'kianda_punch_queue';
const read = (): QueuedPunch[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedPunch[]; } catch { return []; } };
const write = (q: QueuedPunch[]) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* sem armazenamento */ } };

export const pendingPunches = read;

export function enqueuePunch(action: 'in' | 'out'): QueuedPunch {
  const p: QueuedPunch = { ref: crypto.randomUUID(), action, at: new Date().toISOString() };
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
      res = await fetch('/api/v1/attendance/clock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: p.action, at: p.at, clientRef: p.ref }) });
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
