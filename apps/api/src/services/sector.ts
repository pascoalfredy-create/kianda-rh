import {
  ALLOWANCE_PRESETS, SCHEDULE_PRESETS, sectorProfile, type Schedule, type ScheduleKind,
} from '@kianda/core';
import { allowanceTypes, and, auditLogs, eq, inArray, workSchedules, type Db } from '@kianda/db';

type Tx = Pick<Db, 'select' | 'insert' | 'update'>;

/**
 * Aplica a pré-configuração do sector: cria os regimes de horário e os subsídios sugeridos que ainda não existam
 * (por nome do regime / código do subsídio). Nunca altera o que a empresa já configurou.
 */
export async function applySectorPreset(
  tx: Tx, companyId: string, sector: string | null, actorId: string,
  pick?: { schedules?: string[]; allowances?: string[] },
) {
  const profile = sectorProfile(sector);
  const scheduleKeys = (pick?.schedules ?? profile.schedules).filter((k) => SCHEDULE_PRESETS[k]);
  const allowanceKeys = (pick?.allowances ?? profile.allowances).filter((k) => ALLOWANCE_PRESETS[k]);
  const existingS = await tx.select({ name: workSchedules.name }).from(workSchedules).where(eq(workSchedules.companyId, companyId));
  const existingA = await tx.select({ code: allowanceTypes.code }).from(allowanceTypes).where(eq(allowanceTypes.companyId, companyId));
  const newS = scheduleKeys.map((k) => SCHEDULE_PRESETS[k]!).filter((s) => !existingS.some((e) => e.name === s.name));
  const newA = allowanceKeys.map((k) => ALLOWANCE_PRESETS[k]!).filter((a) => !existingA.some((e) => e.code === a.code));
  if (newS.length) {
    await tx.insert(workSchedules).values(newS.map((s) => ({ companyId, name: s.name, kind: s.kind, pattern: s.pattern, note: s.note ?? null, presetKey: s.key })));
  }
  if (newA.length) {
    await tx.insert(allowanceTypes).values(newA.map((a) => ({
      companyId, code: a.code, label: a.label, calc: a.calc, valueMinor: a.valueMinor ?? null, bps: a.bps ?? null, inInss: a.inInss, inIrt: a.inIrt, note: a.note ?? null, presetKey: a.key,
    })));
  }
  if (newS.length || newA.length) {
    await tx.insert(auditLogs).values({ companyId, actorId, action: 'apply_preset', entity: 'company', entityId: companyId, after: { sector, schedules: newS.map((s) => s.key), allowances: newA.map((a) => a.key) } });
  }
  return { schedules: newS.length, allowances: newA.length };
}

export type ScheduleRow = typeof workSchedules.$inferSelect;
export const asSchedule = (s: ScheduleRow): Schedule => ({ kind: s.kind as ScheduleKind, pattern: s.pattern, anchorDate: s.anchorDate });

/** Regimes da empresa por id (para o ponto e o processamento). */
export async function schedulesById(db: Pick<Db, 'select'>, companyId: string, ids?: string[]) {
  const rows = ids && !ids.length ? [] : await db.select().from(workSchedules)
    .where(ids ? and(eq(workSchedules.companyId, companyId), inArray(workSchedules.id, ids)) : eq(workSchedules.companyId, companyId));
  return new Map(rows.map((r) => [r.id, r]));
}
