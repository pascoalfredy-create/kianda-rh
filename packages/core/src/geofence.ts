/**
 * Ponto com localização: avaliação da marcação face aos locais de trabalho da empresa.
 *
 * Princípios (Lei n.º 22/11 — protecção de dados):
 * - a posição é recolhida só no instante da marcação, nunca em contínuo;
 * - com a regra "desligada", nada é pedido nem guardado;
 * - a empresa escolhe: só registar, alertar a chefia ou bloquear a marcação fora do local.
 *
 * O código do quiosque (QR à entrada) prova a presença sem GPS: útil em interiores e caves.
 * Nenhuma das provas é infalível (GPS falsificável, ecrã fotografado em tempo real); não prometer protecção absoluta.
 */

export type LocationMode = 'off' | 'record' | 'alert' | 'block';
export const LOCATION_MODES: Record<LocationMode, string> = {
  off: 'Desligado — não pedir nem guardar a localização',
  record: 'Registar a localização da marcação',
  alert: 'Registar e assinalar marcações fora do local',
  block: 'Bloquear marcações fora do local (com alternativa por código do quiosque)',
};

export interface GeoFix { lat: number; lng: number; accuracy: number }
export interface Workplace { id: string; name: string; lat: number; lng: number; radius: number }

/** Precisão pior do que isto não serve para decidir (rede móvel/IP): conta como "localização indisponível". */
export const MAX_USEFUL_ACCURACY_M = 1000;
/** Margem máxima concedida pela imprecisão do GPS (evita que uma precisão enorme "cubra" tudo). */
export const MAX_ACCURACY_MARGIN_M = 150;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 5000;

/** Distância em metros (fórmula de Haversine, Terra esférica de raio médio). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const validFix = (f: GeoFix | null | undefined): f is GeoFix =>
  !!f && Number.isFinite(f.lat) && Number.isFinite(f.lng) && Number.isFinite(f.accuracy) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 && f.accuracy >= 0;

export type LocationStatus = 'not_required' | 'ok' | 'outside' | 'unavailable' | 'no_workplace';
export interface PunchLocation {
  status: LocationStatus;
  /** A marcação é aceite? (só `block` recusa). */
  allowed: boolean;
  /** Assinalar à chefia (só em `alert`/`block`, para marcações aceites com problema). */
  issue: boolean;
  method: 'gps' | 'kiosk' | 'none';
  workplaceId: string | null;
  workplaceName: string | null;
  /** Distância ao limite do local mais próximo considerado (0 se dentro), arredondada ao metro. */
  distance: number | null;
  message: string | null;
}

/**
 * Decide uma marcação. `assignedWorkplaceId`: o local do colaborador (se definido, só esse conta);
 * senão vale qualquer local activo da empresa. `kioskWorkplaceId`: código do quiosque validado (prova de presença).
 */
export function evaluatePunchLocation(input: { mode: LocationMode; workplaces: Workplace[]; assignedWorkplaceId?: string | null; fix?: GeoFix | null; kioskWorkplaceId?: string | null }): PunchLocation {
  const { mode } = input;
  const base = { method: 'none' as const, workplaceId: null, workplaceName: null, distance: null };
  if (mode === 'off') return { ...base, status: 'not_required', allowed: true, issue: false, message: null };
  const candidates = input.assignedWorkplaceId ? input.workplaces.filter((w) => w.id === input.assignedWorkplaceId) : input.workplaces;
  const fenced = mode === 'alert' || mode === 'block';

  if (input.kioskWorkplaceId) {
    const w = input.workplaces.find((x) => x.id === input.kioskWorkplaceId);
    if (w && (!input.assignedWorkplaceId || w.id === input.assignedWorkplaceId)) {
      return { method: 'kiosk', workplaceId: w.id, workplaceName: w.name, distance: 0, status: 'ok', allowed: true, issue: false, message: null };
    }
    // Código válido mas de outro local: trata-se como fora do local atribuído.
    if (w) {
      const assigned = candidates[0];
      return { method: 'kiosk', workplaceId: w.id, workplaceName: w.name, distance: null, status: 'outside', allowed: mode !== 'block', issue: fenced,
        message: `O código é do local «${w.name}», mas o seu local de trabalho é «${assigned?.name ?? 'outro'}».` };
    }
  }

  if (!validFix(input.fix) || input.fix.accuracy > MAX_USEFUL_ACCURACY_M) {
    return { ...base, status: 'unavailable', allowed: mode !== 'block', issue: fenced,
      message: mode === 'block' ? 'Não foi possível obter a sua localização com precisão. Active a localização do telemóvel ou use o código do quiosque à entrada.' : 'Marcação sem localização (indisponível ou imprecisa).' };
  }
  const fix = input.fix;
  if (!candidates.length) {
    return { ...base, method: 'gps', status: 'no_workplace', allowed: true, issue: false, message: null };
  }
  let best: { w: Workplace; edge: number } | null = null;
  for (const w of candidates) {
    const edge = distanceMeters(fix, w) - w.radius;
    if (!best || edge < best.edge) best = { w, edge };
  }
  const margin = Math.min(fix.accuracy, MAX_ACCURACY_MARGIN_M);
  const inside = best!.edge <= margin;
  const distance = Math.max(0, Math.round(best!.edge));
  if (inside) return { method: 'gps', workplaceId: best!.w.id, workplaceName: best!.w.name, distance: 0, status: 'ok', allowed: true, issue: false, message: null };
  const where = `a ${distance >= 1000 ? `${(distance / 1000).toFixed(1).replace('.', ',')} km` : `${distance} m`} do local «${best!.w.name}»`;
  return { method: 'gps', workplaceId: best!.w.id, workplaceName: best!.w.name, distance, status: 'outside', allowed: mode !== 'block', issue: fenced,
    message: mode === 'block' ? `Está ${where}. A marcação só é aceite no local de trabalho (ou com o código do quiosque à entrada).` : `Marcação ${where}.` };
}

// ───────────── Código do quiosque (QR à entrada, rotativo) ─────────────

export const KIOSK_STEP_SECONDS = 30;

/** Código de 6 dígitos do quiosque para um instante (HMAC-SHA256 do segredo do local sobre a janela de 30 s; Web Crypto). */
export async function kioskCode(secret: string, at: Date = new Date()): Promise<string> {
  const counter = Math.floor(at.getTime() / 1000 / KIOSK_STEP_SECONDS);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(counter))));
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return String(value % 1_000_000).padStart(6, '0');
}

/** Aceita o código da janela actual e da anterior (tempo para ler/escrever), nunca de janelas futuras. */
export async function verifyKioskCode(secret: string, code: string, at: Date = new Date()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const step = KIOSK_STEP_SECONDS * 1000;
  for (const back of [0, 1]) if ((await kioskCode(secret, new Date(at.getTime() - back * step))) === code) return true;
  return false;
}

/** Conteúdo do QR mostrado no quiosque: o colaborador lê-o com a câmara (ou escreve os 6 dígitos). */
export const kioskQrPayload = (workplaceId: string, code: string) => `kianda-ponto:${workplaceId}:${code}`;
export function parseKioskQr(text: string): { workplaceId: string; code: string } | null {
  const m = /^kianda-ponto:([A-Za-z0-9-]{8,64}):(\d{6})$/.exec(text.trim());
  return m ? { workplaceId: m[1]!, code: m[2]! } : null;
}
