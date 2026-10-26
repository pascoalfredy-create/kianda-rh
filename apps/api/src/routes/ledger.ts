import {
  ACCOUNT_ROLES, accountLedger, accountMappingProblem, compareAccounts, csvMoney, DEFAULT_ACCOUNT_MAPPINGS, PGC_CLASS_LABEL, toCsv, trialBalance, type AccountRole,
} from '@kianda/core';
import { accountMappings, and, asc, auditLogs, eq, getDb, gte, isNull, journalEntries, journalLines, lte, sql, type Db } from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';

const range = z.object({ from: z.iso.date(), to: z.iso.date() }).refine((r) => r.from <= r.to, { message: 'O início tem de ser anterior ao fim', path: ['to'] });
const csvResponse = (csv: string, filename: string) =>
  new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } });

/** Plano de contas da empresa: as sugestões por omissão com as alterações gravadas por cima. */
async function chart(db: Db, companyId: string) {
  const rows = await db.select().from(accountMappings).where(eq(accountMappings.companyId, companyId));
  return DEFAULT_ACCOUNT_MAPPINGS.map((d) => {
    const r = rows.find((x) => x.role === d.role);
    return { role: d.role, account: r?.account ?? d.account, label: r?.label ?? d.label, expectedClass: ACCOUNT_ROLES[d.role].expectedClass, group: ACCOUNT_ROLES[d.role].group, isDefault: !r };
  });
}

async function linesUntil(db: Db, companyId: string, to: string) {
  return db.select({
    entryId: journalEntries.id, date: journalEntries.date, reference: journalEntries.reference, journal: journalEntries.journal, entryDescription: journalEntries.description,
    account: journalLines.account, description: journalLines.description, costCenter: journalLines.costCenter, debitMinor: journalLines.debitMinor, creditMinor: journalLines.creditMinor,
  }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalEntries.companyId, companyId), lte(journalEntries.date, to)))
    .orderBy(asc(journalEntries.date), asc(journalEntries.reference));
}

export function ledgerRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/ledger/*', requireCompany);

  /** Diário: lançamentos do período, com as linhas. */
  app.get('/v1/ledger/journal', requireRole('finance', 'payroll'), async (c) => {
    const q = range.and(z.object({ source: z.string().optional() })).parse(c.req.query());
    const db = getDb();
    const conds = [eq(journalEntries.companyId, c.get('actor').companyId), gte(journalEntries.date, q.from), lte(journalEntries.date, q.to)];
    if (q.source) conds.push(eq(journalEntries.source, q.source));
    const entries = await db.query.journalEntries.findMany({ where: and(...conds), with: { lines: true }, orderBy: (j, { asc: a }) => [a(j.date), a(j.reference)] });
    return c.json(entries.map((e) => ({
      ...e, debitMinor: e.lines.reduce((s, l) => s + l.debitMinor, 0), creditMinor: e.lines.reduce((s, l) => s + l.creditMinor, 0),
    })));
  });

  /** Balancete do período (JSON ou CSV). */
  app.get('/v1/ledger/trial-balance', requireRole('finance', 'payroll'), async (c) => {
    const q = range.parse(c.req.query());
    const db = getDb();
    const companyId = c.get('actor').companyId;
    const plan = await chart(db, companyId);
    const tb = trialBalance(await linesUntil(db, companyId, q.to), q.from, q.to);
    const label = (account: string) => plan.find((p) => p.account === account)?.label ?? '';
    const rows = tb.rows.map((r) => ({ ...r, label: label(r.account), classLabel: PGC_CLASS_LABEL[r.class] ?? `Classe ${r.class}` }));
    if (c.req.query('format') === 'csv') {
      const d = (v: number) => (v > 0 ? csvMoney(v) : '');
      const cr = (v: number) => (v < 0 ? csvMoney(-v) : '');
      return csvResponse(toCsv(
        ['Conta', 'Descrição', 'Saldo inicial devedor', 'Saldo inicial credor', 'Débito do período', 'Crédito do período', 'Saldo final devedor', 'Saldo final credor'],
        [...rows.map((r) => [r.account, r.label, d(r.openingMinor), cr(r.openingMinor), csvMoney(r.debitMinor), csvMoney(r.creditMinor), d(r.closingMinor), cr(r.closingMinor)]),
          ['', 'TOTAL', '', '', csvMoney(tb.totals.debitMinor), csvMoney(tb.totals.creditMinor), '', '']],
      ), `balancete-${q.from}-${q.to}.csv`);
    }
    return c.json({ from: q.from, to: q.to, rows, totals: tb.totals });
  });

  /** Razão de uma conta. */
  app.get('/v1/ledger/account', requireRole('finance', 'payroll'), async (c) => {
    const q = range.and(z.object({ code: z.string().min(1) })).parse(c.req.query());
    const db = getDb();
    const companyId = c.get('actor').companyId;
    const plan = await chart(db, companyId);
    const r = accountLedger(await linesUntil(db, companyId, q.to), q.code, q.from, q.to);
    return c.json({ ...r, label: plan.find((p) => p.account === q.code)?.label ?? '' });
  });

  /** Plano de contas parametrizável. */
  app.get('/v1/ledger/accounts', requireRole('finance', 'payroll'), async (c) => c.json(await chart(getDb(), c.get('actor').companyId)));

  app.put('/v1/ledger/accounts', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const roles = Object.keys(ACCOUNT_ROLES) as [AccountRole, ...AccountRole[]];
    const { mappings } = z.object({ mappings: z.array(z.object({ role: z.enum(roles), account: z.string().trim(), label: z.string().trim().min(3, 'Descrição demasiado curta') })).min(1) }).parse(await body(c));
    const problems = mappings.map((m) => accountMappingProblem(m.role, m.account)).filter(Boolean);
    if (problems.length) throw new DomainError('plano_invalido', problems.join(' · '), 400);
    const db = getDb();
    const before = await chart(db, actor.companyId);
    await db.transaction(async (tx) => {
      for (const m of mappings) {
        await tx.insert(accountMappings).values({ companyId: actor.companyId, role: m.role, account: m.account, label: m.label })
          .onConflictDoUpdate({ target: [accountMappings.companyId, accountMappings.role], set: { account: m.account, label: m.label } });
      }
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'chart_of_accounts', entityId: actor.companyId, before: before as unknown as object, after: mappings as unknown as object });
    });
    return c.json(await chart(db, actor.companyId));
  });

  /** Exportação para o ERP (CSV de linhas de lançamento). onlyNew=1: só os ainda não exportados. */
  app.get('/v1/ledger/export', requireRole('finance', 'payroll'), async (c) => {
    const q = range.and(z.object({ onlyNew: z.enum(['0', '1']).optional() })).parse(c.req.query());
    const db = getDb();
    const conds = [eq(journalEntries.companyId, c.get('actor').companyId), gte(journalEntries.date, q.from), lte(journalEntries.date, q.to)];
    if (q.onlyNew === '1') conds.push(isNull(journalEntries.exportedAt));
    const rows = await db.select({ e: journalEntries, l: journalLines }).from(journalLines).innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(...conds)).orderBy(asc(journalEntries.date), asc(journalEntries.reference));
    rows.sort((a, b) => a.e.date.localeCompare(b.e.date) || a.e.reference.localeCompare(b.e.reference) || compareAccounts(a.l.account, b.l.account));
    return csvResponse(toCsv(
      ['Data', 'Diário', 'Referência', 'Descrição do lançamento', 'Conta', 'Descrição da linha', 'Centro de custo', 'Débito', 'Crédito', 'Origem'],
      rows.map(({ e, l }) => [e.date.split('-').reverse().join('/'), e.journal, e.reference, e.description, l.account, l.description, l.costCenter ?? '', l.debitMinor ? csvMoney(l.debitMinor) : '', l.creditMinor ? csvMoney(l.creditMinor) : '', e.source]),
    ), `lancamentos-${q.from}-${q.to}${q.onlyNew === '1' ? '-novos' : ''}.csv`);
  });

  /** Marcar como exportados (depois de importados no ERP). */
  app.post('/v1/ledger/export/mark', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const q = range.parse(await body(c));
    const db = getDb();
    const marked = await db.update(journalEntries).set({ exportedAt: new Date(), exportedBy: actor.actorId })
      .where(and(eq(journalEntries.companyId, actor.companyId), gte(journalEntries.date, q.from), lte(journalEntries.date, q.to), isNull(journalEntries.exportedAt)))
      .returning({ id: journalEntries.id });
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'export', entity: 'journal', entityId: actor.companyId, after: { ...q, entries: marked.length } });
    return c.json({ marked: marked.length });
  });

  /** Resumo: lançamentos por exportar. */
  app.get('/v1/ledger/summary', requireRole('finance', 'payroll'), async (c) => {
    const [r] = await getDb().select({ pending: sql<number>`count(*) filter (where ${journalEntries.exportedAt} is null)::int`, total: sql<number>`count(*)::int` })
      .from(journalEntries).where(eq(journalEntries.companyId, c.get('actor').companyId));
    return c.json(r);
  });

  return app;
}
