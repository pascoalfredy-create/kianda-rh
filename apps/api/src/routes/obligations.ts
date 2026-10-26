import { angolanIbanProblem, csvMoney, getPack, luandaDate, OBLIGATION_LABEL, paymentJournal, payrollObligations, toCsv, type ObligationKind } from '@kianda/core';
import {
  and, asc, auditLogs, companies, desc, employees, eq, getDb, journalEntries, journalLines, payrollLines, payrollPayments, payrollRuns, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { companyAccounts, DomainError } from '../services/payroll.js';

const READERS = ['payroll', 'finance', 'hr_admin'] as const;
const KIND_CODE: Record<ObligationKind, string> = { salaries: 'SAL', inss: 'INSS', irt: 'IRT' };

async function runTotals(db: Db, runId: string) {
  const lines = await db.select().from(payrollLines).where(eq(payrollLines.runId, runId));
  return lines.reduce((t, l) => ({
    netMinor: t.netMinor + l.netMinor, irtMinor: t.irtMinor + l.irtMinor,
    inssEmployeeMinor: t.inssEmployeeMinor + l.inssEmployeeMinor, inssEmployerMinor: t.inssEmployerMinor + l.inssEmployerMinor,
  }), { netMinor: 0, irtMinor: 0, inssEmployeeMinor: 0, inssEmployerMinor: 0 });
}

async function obligationsFor(db: Db, run: typeof payrollRuns.$inferSelect) {
  const payments = await db.select().from(payrollPayments).where(eq(payrollPayments.runId, run.id));
  const paid = Object.fromEntries(payments.map((p) => [p.kind, p.paidOn]));
  const items = payrollObligations({ period: run.period, pack: getPack('AO', Number(run.period.slice(0, 4))), ...(await runTotals(db, run.id)), paid, today: luandaDate(new Date()) });
  return items.map((o) => ({ ...o, reference: payments.find((p) => p.kind === o.kind)?.reference ?? null }));
}

async function closedRun(db: Db, companyId: string, id: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, id), eq(payrollRuns.companyId, companyId)));
  if (!run) throw new DomainError('nao_encontrado', 'Processamento inexistente', 404);
  if (run.status !== 'closed') throw new DomainError('processamento_aberto', 'O processamento ainda não está fechado');
  return run;
}

/**
 * Matéria colectável de linhas fechadas antes da coluna irt_taxable existir: reconstruída a partir do recibo,
 * com as mesmas regras do motor (alimentação/transporte isentos até ao limite do pacote; restantes abonos sujeitos).
 */
function taxableFromBreakdown(l: typeof payrollLines.$inferSelect, period: string): number {
  if (l.irtTaxableMinor || !l.irtMinor) return l.irtTaxableMinor;
  const ex = getPack('AO', Number(period.slice(0, 4))).irt.allowanceExemptionMinor;
  const base = (l.breakdown as { code: string; kind: string; amountMinor: number }[])
    .filter((b) => b.kind === 'earning')
    .reduce((s, b) => s + (b.code === 'ALIM' || b.code === 'TRANSP' ? Math.max(0, b.amountMinor - ex) : b.amountMinor), 0);
  return Math.max(0, base - l.inssEmployeeMinor);
}

const csvResponse = (csv: string, filename: string) =>
  new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } });

export function obligationRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/obligations', requireCompany);
  app.use('/v1/payroll-runs/:id/payments', requireCompany);
  app.use('/v1/payroll-runs/:id/payments/*', requireCompany);
  app.use('/v1/payroll-runs/:id/maps/*', requireCompany);
  app.use('/v1/payroll-runs/:id/bank-file', requireCompany);

  /** Obrigações dos processamentos fechados (mais recentes primeiro). */
  app.get('/v1/obligations', requireRole(...READERS), async (c) => {
    const db = getDb();
    const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, c.get('actor').companyId), eq(payrollRuns.status, 'closed'))).orderBy(desc(payrollRuns.period)).limit(24);
    const out = [];
    for (const run of runs) out.push({ runId: run.id, period: run.period, obligations: await obligationsFor(db, run) });
    return c.json(out);
  });

  /** Registar o pagamento de uma obrigação: gera o lançamento PGC (dívida a débito, banco a crédito). */
  app.post('/v1/payroll-runs/:id/payments', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ kind: z.enum(['salaries', 'inss', 'irt']), paidOn: z.iso.date(), reference: z.string().trim().max(80).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    if (b.paidOn > luandaDate(new Date())) throw new DomainError('data_futura', 'A data de pagamento não pode ser futura', 400);
    if (b.paidOn < `${run.period}-01`) throw new DomainError('data_invalida', 'A data de pagamento é anterior ao mês processado', 400);
    const [exists] = await db.select({ id: payrollPayments.id }).from(payrollPayments).where(and(eq(payrollPayments.runId, run.id), eq(payrollPayments.kind, b.kind)));
    if (exists) throw new DomainError('ja_pago', `${OBLIGATION_LABEL[b.kind]} de ${run.period} já está registado como pago`);
    const t = await runTotals(db, run.id);
    const amount = b.kind === 'salaries' ? t.netMinor : b.kind === 'irt' ? t.irtMinor : t.inssEmployeeMinor + t.inssEmployerMinor;
    const acc = await companyAccounts(db, actor.companyId);
    const payable = b.kind === 'salaries' ? acc.netPayable : b.kind === 'irt' ? acc.irtPayable : acc.socialSecurityPayable;
    const ref = `PG-${KIND_CODE[b.kind]}-${run.period.replace('-', '')}`;
    const entry = paymentJournal(b.paidOn, ref, `Pagamento ${OBLIGATION_LABEL[b.kind]} ${run.period}${b.reference ? ` (${b.reference})` : ''}`, payable, amount, acc);
    const result = await db.transaction(async (tx) => {
      const [je] = await tx.insert(journalEntries).values({ companyId: actor.companyId, date: entry.date, journal: entry.journal, reference: entry.reference, description: entry.description, source: 'payroll_payment' }).returning();
      await tx.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      const [p] = await tx.insert(payrollPayments).values({ companyId: actor.companyId, runId: run.id, kind: b.kind, paidOn: b.paidOn, amountMinor: amount, reference: b.reference ?? null, journalEntryId: je!.id, createdBy: actor.actorId }).returning();
      const col = b.kind === 'salaries' ? { paidSalariesAt: b.paidOn } : b.kind === 'irt' ? { paidIrtAt: b.paidOn } : { paidInssAt: b.paidOn };
      await tx.update(payrollRuns).set(col).where(eq(payrollRuns.id, run.id));
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'pay', entity: 'payroll_run', entityId: run.id, after: { ...p, journal: ref } });
      return p;
    });
    return c.json({ ...result, journalReference: ref }, 201);
  });

  /** Anular um pagamento registado por engano: lançamento de estorno (nunca se apagam lançamentos). */
  app.post('/v1/payroll-runs/:id/payments/:kind/reverse', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const kind = z.enum(['salaries', 'inss', 'irt']).parse(c.req.param('kind'));
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo do estorno') }).parse(await body(c));
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [p] = await db.select().from(payrollPayments).where(and(eq(payrollPayments.runId, run.id), eq(payrollPayments.kind, kind)));
    if (!p) return c.json({ error: 'nao_encontrado', message: 'Não há pagamento registado' }, 404);
    const original = p.journalEntryId ? await db.query.journalEntries.findFirst({ where: eq(journalEntries.id, p.journalEntryId), with: { lines: true } }) : null;
    const today = luandaDate(new Date());
    const ref = `ES-${KIND_CODE[kind]}-${run.period.replace('-', '')}-${Date.now().toString(36).toUpperCase()}`;
    await db.transaction(async (tx) => {
      if (original) {
        const [je] = await tx.insert(journalEntries).values({ companyId: actor.companyId, date: today, journal: 'Bancos', reference: ref, description: `Estorno de ${original.reference}: ${note}`, source: 'payroll_payment' }).returning();
        await tx.insert(journalLines).values(original.lines.map((l) => ({ entryId: je!.id, account: l.account, description: `Estorno: ${l.description}`, debitMinor: l.creditMinor, creditMinor: l.debitMinor })));
      }
      await tx.delete(payrollPayments).where(eq(payrollPayments.id, p.id));
      const col = kind === 'salaries' ? { paidSalariesAt: null } : kind === 'irt' ? { paidIrtAt: null } : { paidInssAt: null };
      await tx.update(payrollRuns).set(col).where(eq(payrollRuns.id, run.id));
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'reverse_payment', entity: 'payroll_run', entityId: run.id, before: { ...p }, after: { note, journal: ref } });
    });
    return c.json({ ok: true, journalReference: ref });
  });

  /** Mapa de IRT (Grupo A) por colaborador. JSON ou CSV (?format=csv). */
  app.get('/v1/payroll-runs/:id/maps/irt', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const data = rows.map(({ l, e }) => {
      const taxable = taxableFromBreakdown(l, run.period);
      const taxableBeforeInss = taxable ? taxable + l.inssEmployeeMinor : null;
      return {
        number: e.number, name: e.name, nif: e.nif ?? e.biNumber ?? '', gross: l.grossMinor,
        exempt: taxableBeforeInss !== null ? Math.max(0, l.grossMinor - taxableBeforeInss) : null,
        inss: l.inssEmployeeMinor, taxable, bracket: l.irtBracket, irt: l.irtMinor,
      };
    });
    if (c.req.query('format') === 'csv') {
      return csvResponse(toCsv(
        ['N.º', 'Nome', 'NIF/BI', 'Rendimento ilíquido', 'Rendimentos isentos/não sujeitos', 'INSS (3%)', 'Matéria colectável', 'Escalão', 'IRT retido'],
        [...data.map((d) => [d.number, d.name, d.nif, csvMoney(d.gross), d.exempt === null ? '' : csvMoney(d.exempt), csvMoney(d.inss), csvMoney(d.taxable), d.bracket, csvMoney(d.irt)]),
          ['', 'TOTAL', '', csvMoney(data.reduce((s, d) => s + d.gross, 0)), '', csvMoney(data.reduce((s, d) => s + d.inss, 0)), csvMoney(data.reduce((s, d) => s + d.taxable, 0)), '', csvMoney(data.reduce((s, d) => s + d.irt, 0))]],
      ), `mapa-irt-${run.period}.csv`);
    }
    return c.json({ period: run.period, rows: data, totalIrt: data.reduce((s, d) => s + d.irt, 0) });
  });

  /** Folha de remunerações para o INSS. JSON ou CSV. */
  app.get('/v1/payroll-runs/:id/maps/inss', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const data = rows.map(({ l, e }) => ({ number: e.number, name: e.name, inssNumber: e.inssNumber ?? '', base: l.inssBaseMinor, employee: l.inssEmployeeMinor, employer: l.inssEmployerMinor, total: l.inssEmployeeMinor + l.inssEmployerMinor }));
    const missing = data.filter((d) => !d.inssNumber).map((d) => d.name);
    if (c.req.query('format') === 'csv') {
      return csvResponse(toCsv(
        ['N.º', 'Nome', 'N.º Segurança Social', 'Base de incidência', 'Trabalhador (3%)', 'Entidade empregadora (8%)', 'Total'],
        [...data.map((d) => [d.number, d.name, d.inssNumber, csvMoney(d.base), csvMoney(d.employee), csvMoney(d.employer), csvMoney(d.total)]),
          ['', `TOTAL — contribuinte ${co?.inssNumber ?? '(sem n.º INSS da empresa)'}`, '', csvMoney(data.reduce((s, d) => s + d.base, 0)), csvMoney(data.reduce((s, d) => s + d.employee, 0)), csvMoney(data.reduce((s, d) => s + d.employer, 0)), csvMoney(data.reduce((s, d) => s + d.total, 0))]],
      ), `folha-inss-${run.period}.csv`);
    }
    return c.json({ period: run.period, companyInssNumber: co?.inssNumber ?? null, rows: data, missingInssNumber: missing });
  });

  /** Ficheiro de transferência dos salários (CSV genérico: IBAN; Nome; Valor; Descritivo). */
  app.get('/v1/payroll-runs/:id/bank-file', requireRole('finance', 'payroll'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const ok = rows.filter(({ e, l }) => e.iban && !angolanIbanProblem(e.iban) && l.netMinor > 0);
    const excluded = rows.filter((r) => !ok.includes(r)).map(({ e, l }) => ({ name: e.name, netMinor: l.netMinor, reason: !e.iban ? 'sem IBAN' : angolanIbanProblem(e.iban) ? 'IBAN inválido' : 'líquido zero' }));
    if (c.req.query('format') === 'json') {
      return c.json({ period: run.period, count: ok.length, totalMinor: ok.reduce((s, r) => s + r.l.netMinor, 0), excluded });
    }
    const desc = `SALARIO ${run.period.slice(5, 7)}/${run.period.slice(0, 4)}`;
    return csvResponse(toCsv(['IBAN', 'Nome do beneficiário', 'Valor', 'Descritivo', 'Referência'],
      ok.map(({ e, l }) => [e.iban, e.name, csvMoney(l.netMinor), desc, `${run.period.replace('-', '')}-${e.number}`])), `transferencias-salarios-${run.period}.csv`);
  });

  return app;
}
