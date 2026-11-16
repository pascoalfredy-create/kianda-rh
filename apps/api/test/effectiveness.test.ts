import { afterAll, describe, expect, it } from 'vitest';
import { absences, attendanceEntries, closeDb, getDb } from '@kianda/db';
import { buildApp } from '../src/app.js';
import { testClient } from './inject.js';
import { renderEffectivenessPdf } from '../src/lib/effectiveness-pdf.js';
import type { EffectivenessCode } from '@kianda/core';

const app = testClient(buildApp({ rateLimit: false }));
afterAll(async () => {
  await app.close();
  if (process.env.DATABASE_URL) await closeDb();
});

describe.skipIf(!process.env.DATABASE_URL)('mapa de efectividade', () => {
  it(
    'um código por dia a partir do ponto, ausências, descanso e feriados; Excel e PDF',
    { timeout: 30_000 },
    async () => {
      const nif = String(Math.floor(Math.random() * 10_000_000_000)).padStart(10, '0');
      const r = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          acceptTerms: true,
          company: { name: 'Mapa Efectividade, Lda', nif },
          name: 'Dona',
          email: `efect.${Date.now()}@kianda.test`,
          password: 'MapaEfectividade2026',
        },
      });
      expect(r.statusCode, r.body).toBe(201);
      const companyId = r.json().company.id,
        userId = r.json().user.id;
      const cookie = `kianda_session=${r.cookies.find(c => c.name === 'kianda_session')!.value}`;
      const call = (method: string, url: string, payload?: unknown) =>
        app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
      const hire = async (number: string, name: string) => {
        const e = await call('POST', '/v1/employees', {
          number,
          name,
          jobTitle: 'Técnico',
          contract: { type: 'indefinite', startDate: '2026-01-01', base: 300000 },
        });
        expect(e.statusCode, e.body).toBe(201);
        return e.json().id as string;
      };
      const ana = await hire('1', 'Ana Picadora'),
        bruno = await hire('2', 'Bruno Ferias');
      // Setembro de 2026: Ana pica em todos os dias úteis excepto 14, 15 e 22; 17 é feriado.
      const days: string[] = [];
      for (let d = 1; d <= 30; d++) {
        const iso = `2026-09-${String(d).padStart(2, '0')}`;
        const w = new Date(`${iso}T12:00:00Z`).getUTCDay();
        if (w !== 0 && w !== 6 && !['2026-09-14', '2026-09-15', '2026-09-22', '2026-09-17'].includes(iso))
          days.push(iso);
      }
      await getDb()
        .insert(attendanceEntries)
        .values(
          days.map(d => ({
            companyId,
            employeeId: ana,
            workDate: d,
            clockIn: new Date(`${d}T07:00:00Z`),
            clockOut: new Date(`${d}T16:00:00Z`),
            source: 'web' as const,
            createdBy: userId,
          })),
        );
      const ok = await call('POST', '/v1/attendance/approve', {
        employeeId: ana,
        period: '2026-09',
        noRecord: 'absent',
      });
      expect(ok.statusCode, ok.body).toBe(201);
      // Bruno: férias aprovadas de 21 a 25; sem marcações nos outros dias úteis.
      await getDb().insert(absences).values({
        companyId,
        employeeId: bruno,
        type: 'vacation',
        startDate: '2026-09-21',
        endDate: '2026-09-25',
        workingDays: 5,
        status: 'approved',
      });

      const res = await call('GET', '/v1/attendance/effectiveness?period=2026-09');
      expect(res.statusCode, res.body).toBe(200);
      const map = res.json();
      expect(map.days).toHaveLength(30);
      expect(map.days[16]).toMatchObject({ date: '2026-09-17', holiday: expect.any(String) });
      expect(map.provisional).toBe(true);
      const row = (name: string) => map.rows.find((x: { employee: { name: string } }) => x.employee.name === name);
      const a = row('Ana Picadora'),
        b = row('Bruno Ferias');
      const code = (x: { codes: string[] }, day: number) => x.codes[day - 1];
      expect([code(a, 1), code(a, 5), code(a, 14), code(a, 15), code(a, 17), code(a, 22)]).toEqual([
        'P',
        '·',
        'FI',
        'FI',
        'Fr',
        'FI',
      ]);
      expect(a.totals).toMatchObject({ worked: days.length, unjustified: 3, noRecord: 0 });
      expect(a.approved).toBe(true);
      expect(a.overtimeMinutes).toBeGreaterThan(0);
      expect([code(b, 21), code(b, 25), code(b, 26), code(b, 1)]).toEqual(['Fé', 'Fé', '·', 'SR']);
      expect(b.totals.vacation).toBe(5);

      // Em pré-visualização (sem subscrição paga) as saídas para arquivo ficam bloqueadas; o ecrã continua disponível.
      for (const format of ['xlsx', 'pdf'])
        expect((await call('GET', `/v1/attendance/effectiveness?period=2026-09&format=${format}`)).statusCode).toBe(
          402,
        );
      const pdf = renderEffectivenessPdf({
        companyName: map.companyName,
        periodLabel: map.periodLabel,
        provisional: map.provisional,
        generatedAt: new Date(),
        days: map.days.map((d: { date: string; weekday: string; weekend: boolean }) => ({ ...d, off: d.weekend })),
        rows: map.rows.map((x: { employee: { name: string; number: string }; codes: EffectivenessCode[] }) => ({
          name: x.employee.name,
          number: x.employee.number,
          codes: x.codes,
          totals: [1, 2, 3, 4, 5, 6, 7, '1,5'],
        })),
        totalHeaders: ['DT', 'FI', 'FJ', 'Fé', 'D', 'L', 'SR', 'HE'],
      });
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(10_000);
      expect((await call('GET', '/v1/attendance/effectiveness?period=2026-13')).statusCode).toBe(400);
    },
  );
});
