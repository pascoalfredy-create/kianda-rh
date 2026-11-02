import { describe, expect, it } from 'vitest';
import { distanceMeters, evaluatePunchLocation, kioskCode, kioskQrPayload, parseKioskQr, verifyKioskCode, type Workplace } from '../src/index.js';

// Coordenadas reais de referência (Luanda): Marginal / Baía e Talatona.
const sede: Workplace = { id: 'w-sede-0001', name: 'Sede — Marginal', lat: -8.8125, lng: 13.2302, radius: 150 };
const obra: Workplace = { id: 'w-obra-0002', name: 'Obra Talatona', lat: -8.9172, lng: 13.1856, radius: 300 };
const near = { lat: -8.8131, lng: 13.2305, accuracy: 20 }; // ~70 m da sede
const talatona = { lat: -8.9180, lng: 13.1860, accuracy: 15 };

describe('distância (Haversine)', () => {
  it('Marginal → Talatona ≈ 12,5 km; mesmo ponto = 0', () => {
    expect(distanceMeters(sede, obra)).toBeGreaterThan(12_000);
    expect(distanceMeters(sede, obra)).toBeLessThan(13_000);
    expect(distanceMeters(sede, sede)).toBe(0);
  });
  it('1 grau de latitude ≈ 111,2 km', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  });
});

describe('avaliação da marcação', () => {
  const places = [sede, obra];
  it('desligado: não pede nem avalia nada', () => {
    expect(evaluatePunchLocation({ mode: 'off', workplaces: places, fix: near })).toMatchObject({ status: 'not_required', allowed: true, issue: false, method: 'none' });
  });
  it('dentro do raio: aceite sem alerta, com o local identificado', () => {
    for (const mode of ['record', 'alert', 'block'] as const) {
      expect(evaluatePunchLocation({ mode, workplaces: places, fix: near })).toMatchObject({ status: 'ok', allowed: true, issue: false, workplaceId: sede.id, distance: 0, method: 'gps' });
    }
  });
  it('fora do raio: registar aceita; alertar aceita e assinala; bloquear recusa', () => {
    const far = { lat: -8.83, lng: 13.25, accuracy: 10 };
    expect(evaluatePunchLocation({ mode: 'record', workplaces: places, fix: far })).toMatchObject({ status: 'outside', allowed: true, issue: false });
    expect(evaluatePunchLocation({ mode: 'alert', workplaces: places, fix: far })).toMatchObject({ status: 'outside', allowed: true, issue: true });
    const blocked = evaluatePunchLocation({ mode: 'block', workplaces: places, fix: far });
    expect(blocked).toMatchObject({ status: 'outside', allowed: false, issue: true, workplaceId: sede.id });
    expect(blocked.distance).toBeGreaterThan(2000);
    expect(blocked.message).toMatch(/km do local «Sede — Marginal»/);
  });
  it('local atribuído: só esse conta (estar na sede não vale para quem trabalha na obra)', () => {
    expect(evaluatePunchLocation({ mode: 'block', workplaces: places, assignedWorkplaceId: obra.id, fix: near })).toMatchObject({ status: 'outside', allowed: false, workplaceId: obra.id });
    expect(evaluatePunchLocation({ mode: 'block', workplaces: places, assignedWorkplaceId: obra.id, fix: talatona })).toMatchObject({ status: 'ok', workplaceId: obra.id });
  });
  it('a imprecisão do GPS dá margem, mas limitada a 150 m', () => {
    // ~220 m do centro da sede (70 m fora do raio de 150 m).
    const edge = { lat: -8.8145, lng: 13.2302 };
    expect(evaluatePunchLocation({ mode: 'block', workplaces: [sede], fix: { ...edge, accuracy: 5 } }).allowed).toBe(false);
    expect(evaluatePunchLocation({ mode: 'block', workplaces: [sede], fix: { ...edge, accuracy: 80 } }).allowed).toBe(true);
    // 5 km fora não passa nem com precisão de 900 m.
    expect(evaluatePunchLocation({ mode: 'block', workplaces: [sede], fix: { lat: -8.86, lng: 13.23, accuracy: 900 } }).allowed).toBe(false);
  });
  it('sem localização ou imprecisa (> 1 km): bloquear recusa com alternativa; os outros aceitam', () => {
    for (const fix of [null, { lat: -8.81, lng: 13.23, accuracy: 2500 }, { lat: Number.NaN, lng: 13, accuracy: 10 }]) {
      expect(evaluatePunchLocation({ mode: 'alert', workplaces: places, fix })).toMatchObject({ status: 'unavailable', allowed: true, issue: true });
      const r = evaluatePunchLocation({ mode: 'block', workplaces: places, fix });
      expect(r).toMatchObject({ status: 'unavailable', allowed: false });
      expect(r.message).toMatch(/código do quiosque/);
    }
  });
  it('sem locais configurados: regista a posição mas não pode decidir', () => {
    expect(evaluatePunchLocation({ mode: 'block', workplaces: [], fix: near })).toMatchObject({ status: 'no_workplace', allowed: true, issue: false, method: 'gps' });
  });
  it('código do quiosque prova a presença sem GPS; de outro local não vale para quem tem local atribuído', () => {
    expect(evaluatePunchLocation({ mode: 'block', workplaces: places, kioskWorkplaceId: sede.id })).toMatchObject({ status: 'ok', allowed: true, method: 'kiosk', workplaceId: sede.id });
    expect(evaluatePunchLocation({ mode: 'block', workplaces: places, assignedWorkplaceId: obra.id, kioskWorkplaceId: sede.id })).toMatchObject({ status: 'outside', allowed: false, method: 'kiosk' });
  });
});

describe('código rotativo do quiosque', () => {
  const secret = 'segredo-de-teste-do-local-0123456789';
  const t = new Date('2026-11-02T10:00:15Z');
  it('6 dígitos, estável na janela de 30 s e diferente na seguinte', async () => {
    const a = await kioskCode(secret, t);
    expect(a).toMatch(/^\d{6}$/);
    expect(await kioskCode(secret, new Date('2026-11-02T10:00:29Z'))).toBe(a);
    expect(await kioskCode(secret, new Date('2026-11-02T10:00:31Z'))).not.toBe(a);
    expect(await kioskCode('outro-segredo-0123456789-abcdef', t)).not.toBe(a);
  });
  it('aceita a janela actual e a anterior, recusa códigos antigos ou futuros', async () => {
    const now = await kioskCode(secret, t);
    expect(await verifyKioskCode(secret, now, t)).toBe(true);
    expect(await verifyKioskCode(secret, now, new Date(t.getTime() + 30_000))).toBe(true);
    expect(await verifyKioskCode(secret, now, new Date(t.getTime() + 61_000))).toBe(false);
    expect(await verifyKioskCode(secret, await kioskCode(secret, new Date(t.getTime() + 30_000)), t)).toBe(false);
    expect(await verifyKioskCode(secret, '12345', t)).toBe(false);
  });
  it('conteúdo do QR', () => {
    expect(parseKioskQr(kioskQrPayload('w-sede-0001', '042137'))).toEqual({ workplaceId: 'w-sede-0001', code: '042137' });
    expect(parseKioskQr('https://exemplo.com')).toBeNull();
  });
});
