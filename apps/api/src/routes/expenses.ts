import {
  angolanIbanProblem, claimProblems, claimTotals, csvMoney, EXPENSE_CATEGORIES, expenseApprovalJournal, lineAmount, luandaDate, paymentJournal, toCsv,
  type ExpenseLineInput,
} from '@kianda/core';
import {
  and, asc, auditLogs, bankAccounts, companies, departments, desc, eq, expenseClaims, expenseLines, getDb, journalEntries, journalLines, like, sql,
  employees, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { undoMatch } from '../services/payments.js';
import { companyAccounts, DomainError } from '../services/payroll.js';
import { canDecideFor, visibleEmployeeIds } from '../services/scope.js';

const STAFF = ['owner', 'hr_admin', 'finance'];
const kz = z.number().nonnegative().max(1e11);
const lineBody = z.object({
  kind: z.enum(['expense', 'per_diem']),
  date: z.iso.date(),
  description: z.string().trim().max(200),
  category: z.enum(Object.keys(EXPENSE_CATEGORIES) as [keyof typeof EXPENSE_CATEGORIES]).optional().nullable(),
  amount: kz.optional().nullable(),
  documentRef: z.string().trim().max(60).optional().nullable(),
  supplierNif: z.string().trim().max(20).optional().nullable(),
  zone: z.enum(['national', 'international']).optional().nullable(),
  days: z.number().positive().max(366).optional().nullable(),
  rate: kz.optional().nullable(),
});
const claimBody = z.object({
  employeeId: z.string().optional(),
  title: z.string().trim().min(3, 'Indique o motivo (ex.: deslocação ao Lobito)').max(120),
  tripFrom: z.iso.date().optional().nullable(),
  tripTo: z.iso.date().optional().nullable(),
  lines: z.array(lineBody).max(100),
}).refine((b) => !b.tripFrom || !b.tripTo || b.tripFrom <= b.tripTo, { message: 'O regresso é anterior à partida', path: ['tripTo'] });

const toMinor = (v: number | null | undefined) => (v === null || v === undefined ? undefined : Math.round(v * 100));
function toInput(l: z.infer<typeof lineBody>): ExpenseLineInput {
  return {
    kind: l.kind, date: l.date, description: l.description, category: l.category ?? undefined, amountMinor: toMinor(l.amount),
    documentRef: l.documentRef ?? null, supplierNif: l.supplierNif ?? null, zone: l.zone ?? undefined, days: l.days ?? undefined, rateMinor: toMinor(l.rate),
  };
}
function fromRow(l: typeof expenseLines.$inferSelect): ExpenseLineInput {
  return {
    kind: l.kind as 'expense' | 'per_diem', date: l.date, description: l.description, category: (l.category ?? undefined) as ExpenseLineInput['category'],
    amountMinor: l.amountMinor, documentRef: l.documentRef, supplierNif: l.supplierNif, zone: (l.zone ?? undefined) as ExpenseLineInput['zone'],
    days: l.halfDays === null ? undefined : l.halfDays / 2, rateMinor: l.rateMinor ?? undefined,
  };
}

async function rates(db: Db, companyId: string) {
  const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
  return { national: co?.perDiemNationalMinor ?? null, international: co?.perDiemInternationalMinor ?? null };
}

async function load(db: Db, actor: Actor, id: string) {
  const [row] = await db.select({ c: expenseClaims, e: employees }).from(expenseClaims).innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
    .where(and(eq(expenseClaims.id, id), eq(expenseClaims.companyId, actor.companyId)));
  if (!row) throw new DomainError('nao_encontrado', 'Nota de despesas inexistente', 404);
  const visible = await visibleEmployeeIds(db, actor);
  if (visible !== null && !visible.includes(row.c.employeeId)) throw new DomainError('nao_encontrado', 'Nota de despesas inexistente', 404);
  return row;
}

/** Quem pode editar: o próprio colaborador, quem criou a nota, ou RH/Finanças/proprietário — só em rascunho ou recusada. */
const canEdit = (actor: Actor, c: typeof expenseClaims.$inferSelect) =>
  (c.status === 'draft' || c.status === 'rejected') && (actor.employeeId === c.employeeId || actor.actorId === c.createdBy || STAFF.includes(actor.role));

async function nextNumber(db: Db, companyId: string, year: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(expenseClaims).where(and(eq(expenseClaims.companyId, companyId), like(expenseClaims.number, `ND-${year}-%`)));
  return `ND-${year}-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

async function writeLines(tx: Parameters<Parameters<Db['transaction']>[0]>[0], claimId: string, lines: ExpenseLineInput[]) {
  await tx.delete(expenseLines).where(eq(expenseLines.claimId, claimId));
  if (!lines.length) return;
  await tx.insert(expenseLines).values(lines.map((l, i) => ({
    claimId, position: i, kind: l.kind, date: l.date, description: l.description || '', category: l.kind === 'expense' ? l.category ?? null : null,
    documentRef: l.kind === 'expense' ? l.documentRef ?? null : null, supplierNif: l.kind === 'expense' ? l.supplierNif ?? null : null,
    zone: l.kind === 'per_diem' ? l.zone ?? null : null, halfDays: l.kind === 'per_diem' && l.days ? Math.round(l.days * 2) : null,
    rateMinor: l.kind === 'per_diem' ? l.rateMinor ?? null : null, amountMinor: lineAmount(l),
  })));
}

export function expenseRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/expenses', requireCompany);
  app.use('/v1/expenses/*', requireCompany);
  app.use('/v1/expenses-bank-file', requireCompany);

  /** Listas: as minhas, para aprovar (chefia/RH), por pagar (Finanças), todas (RH/Finanças). */
  app.get('/v1/expenses', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const scope = z.enum(['mine', 'approve', 'pay', 'all']).default('mine').parse(c.req.query('scope') ?? undefined);
    const where = [eq(expenseClaims.companyId, actor.companyId)];
    if (scope === 'mine') {
      if (!actor.employeeId) return c.json([]);
      where.push(eq(expenseClaims.employeeId, actor.employeeId));
    } else if (scope === 'approve') where.push(eq(expenseClaims.status, 'submitted'));
    else if (scope === 'pay') {
      if (!['owner', 'finance'].includes(actor.role)) return c.json([]);
      where.push(eq(expenseClaims.status, 'approved'));
    } else if (!STAFF.includes(actor.role) && actor.role !== 'payroll') return c.json([]);
    const rows = await db.select({ c: expenseClaims, e: employees }).from(expenseClaims).innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .where(and(...where)).orderBy(desc(expenseClaims.createdAt)).limit(300);
    const out = scope === 'approve' ? rows.filter(({ e }) => canDecideFor(actor, e)) : rows;
    return c.json(out.map(({ c: x, e }) => ({ ...x, employeeName: e.name, employeeNumber: e.number })));
  });

  app.get('/v1/expenses/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { c: claim, e } = await load(db, actor, c.req.param('id'));
    const lines = await db.select().from(expenseLines).where(eq(expenseLines.claimId, claim.id)).orderBy(asc(expenseLines.position));
    const r = await rates(db, actor.companyId);
    return c.json({
      ...claim, employee: { id: e.id, name: e.name, number: e.number, jobTitle: e.jobTitle, iban: e.iban },
      lines: lines.map((l) => ({ ...l, days: l.halfDays === null ? null : l.halfDays / 2 })),
      totals: claimTotals(lines.map(fromRow)), rates: r,
      problems: claimProblems(lines.map(fromRow), { today: luandaDate(new Date()), rates: r }),
      can: {
        edit: canEdit(actor, claim),
        submit: canEdit(actor, claim) && lines.length > 0,
        decide: claim.status === 'submitted' && canDecideFor(actor, e),
        pay: claim.status === 'approved' && ['owner', 'finance'].includes(actor.role),
        reversePayment: claim.status === 'paid' && ['owner', 'finance'].includes(actor.role),
        cancel: ['draft', 'submitted', 'rejected'].includes(claim.status) && (actor.employeeId === claim.employeeId || actor.actorId === claim.createdBy || STAFF.includes(actor.role)),
      },
    });
  });

  app.post('/v1/expenses', async (c) => {
    const actor = c.get('actor');
    const b = claimBody.parse(await body(c));
    const db = getDb();
    const employeeId = b.employeeId ?? actor.employeeId;
    if (!employeeId) throw new DomainError('sem_colaborador', 'Indique o colaborador da nota de despesas', 400);
    if (employeeId !== actor.employeeId && !STAFF.includes(actor.role)) throw new DomainError('sem_permissao', 'Só pode criar notas de despesas em seu nome', 403);
    const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.companyId, actor.companyId)));
    if (!emp) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
    const lines = b.lines.map(toInput);
    const year = luandaDate(new Date()).slice(0, 4);
    for (let attempt = 0; ; attempt++) {
      try {
        const claim = await db.transaction(async (tx) => {
          const [x] = await tx.insert(expenseClaims).values({
            companyId: actor.companyId, employeeId, number: await nextNumber(db, actor.companyId, year), title: b.title, tripFrom: b.tripFrom ?? null, tripTo: b.tripTo ?? null,
            totalMinor: claimTotals(lines).totalMinor, createdBy: actor.actorId,
          }).returning();
          await writeLines(tx, x!.id, lines);
          await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'expense_claim', entityId: x!.id, after: { ...x, lines: lines.length } });
          return x!;
        });
        return c.json(claim, 201);
      } catch (err) {
        if (attempt < 2 && String((err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) === '23505') continue;
        throw err;
      }
    }
  });

  app.put('/v1/expenses/:id', async (c) => {
    const actor = c.get('actor');
    const b = claimBody.parse(await body(c));
    const db = getDb();
    const { c: claim } = await load(db, actor, c.req.param('id'));
    if (!canEdit(actor, claim)) throw new DomainError('nao_editavel', 'Esta nota de despesas já não pode ser alterada');
    const lines = b.lines.map(toInput);
    const updated = await db.transaction(async (tx) => {
      const [x] = await tx.update(expenseClaims).set({ title: b.title, tripFrom: b.tripFrom ?? null, tripTo: b.tripTo ?? null, totalMinor: claimTotals(lines).totalMinor, status: 'draft' })
        .where(eq(expenseClaims.id, claim.id)).returning();
      await writeLines(tx, claim.id, lines);
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'expense_claim', entityId: claim.id, before: claim, after: { ...x, lines: lines.length } });
      return x!;
    });
    return c.json(updated);
  });

  app.post('/v1/expenses/:id/submit', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { c: claim } = await load(db, actor, c.req.param('id'));
    if (!canEdit(actor, claim)) throw new DomainError('nao_editavel', 'Esta nota de despesas já foi submetida');
    const lines = (await db.select().from(expenseLines).where(eq(expenseLines.claimId, claim.id))).map(fromRow);
    const problems = claimProblems(lines, { today: luandaDate(new Date()), rates: await rates(db, actor.companyId) });
    if (problems.length) throw new DomainError('nota_incompleta', problems.join(' · '), 400);
    const [x] = await db.update(expenseClaims).set({ status: 'submitted', submittedAt: new Date(), decidedBy: null, decidedAt: null, decisionNote: null }).where(eq(expenseClaims.id, claim.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'submit', entity: 'expense_claim', entityId: claim.id, after: x });
    return c.json(x);
  });

  /** Aprovar (gera o lançamento: custo contra dívida ao trabalhador) ou recusar com motivo. */
  app.post('/v1/expenses/:id/decision', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional().nullable() }).parse(await body(c));
    const db = getDb();
    const { c: claim, e } = await load(db, actor, c.req.param('id'));
    if (claim.status !== 'submitted') throw new DomainError('estado_invalido', 'A nota não está à espera de decisão');
    if (!canDecideFor(actor, e)) throw new DomainError('sem_permissao', 'Não pode decidir sobre esta nota (só a chefia directa ou o RH; nunca o próprio)', 403);
    if (!b.approve && !b.note) throw new DomainError('motivo_obrigatorio', 'Indique o motivo da recusa', 400);
    const today = luandaDate(new Date());
    const result = await db.transaction(async (tx) => {
      let journalId: string | null = null;
      if (b.approve) {
        const lines = (await tx.select().from(expenseLines).where(eq(expenseLines.claimId, claim.id))).map(fromRow);
        const [dept] = e.departmentId ? await tx.select().from(departments).where(eq(departments.id, e.departmentId)) : [];
        const entry = expenseApprovalJournal(today, claim.number, `${e.name} — ${claim.title}`, lines, dept?.costCenter, await companyAccounts(db, actor.companyId));
        const [je] = await tx.insert(journalEntries).values({ companyId: actor.companyId, date: entry.date, journal: entry.journal, reference: entry.reference, description: entry.description, source: 'expense' }).returning();
        await tx.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, costCenter: l.costCenter ?? null, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
        journalId = je!.id;
      }
      const [x] = await tx.update(expenseClaims).set({ status: b.approve ? 'approved' : 'rejected', decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: b.note ?? null, approvalJournalId: journalId })
        .where(eq(expenseClaims.id, claim.id)).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: b.approve ? 'approve' : 'reject', entity: 'expense_claim', entityId: claim.id, after: x });
      return x!;
    });
    return c.json(result);
  });

  /** Reembolso por transferência: lançamento da dívida ao trabalhador contra a conta bancária. */
  app.post('/v1/expenses/:id/pay', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ paidOn: z.iso.date(), reference: z.string().trim().max(80).optional().nullable(), bankAccountId: z.string().optional().nullable() }).parse(await body(c));
    const db = getDb();
    const { c: claim, e } = await load(db, actor, c.req.param('id'));
    if (claim.status !== 'approved') throw new DomainError('estado_invalido', claim.status === 'paid' ? 'Esta nota já foi paga' : 'Só se pagam notas aprovadas');
    if (b.paidOn > luandaDate(new Date())) throw new DomainError('data_futura', 'A data de pagamento não pode ser futura', 400);
    const acc = await companyAccounts(db, actor.companyId);
    let bankAccountId = b.bankAccountId ?? null;
    if (bankAccountId) {
      const [ba] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, actor.companyId)));
      if (!ba) throw new DomainError('conta_inexistente', 'Conta bancária inexistente', 404);
      acc.bank = ba.ledgerAccount;
    } else {
      const [first] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.companyId, actor.companyId), eq(bankAccounts.active, true))).limit(1);
      bankAccountId = first?.id ?? null;
      if (first) acc.bank = first.ledgerAccount;
    }
    const used = await db.select({ r: journalEntries.reference }).from(journalEntries).where(and(eq(journalEntries.companyId, actor.companyId), like(journalEntries.reference, `PG-${claim.number}%`)));
    const ref = used.length ? `PG-${claim.number}-${used.length + 1}` : `PG-${claim.number}`;
    const entry = paymentJournal(b.paidOn, ref, `Reembolso ${claim.number} — ${e.name}${b.reference ? ` (${b.reference})` : ''}`, acc.expensesPayable, claim.totalMinor, acc);
    const x = await db.transaction(async (tx) => {
      const [je] = await tx.insert(journalEntries).values({ companyId: actor.companyId, date: entry.date, journal: entry.journal, reference: ref, description: entry.description, source: 'expense_payment' }).returning();
      await tx.insert(journalLines).values(entry.lines.map((l) => ({ entryId: je!.id, account: l.account, description: l.description, debitMinor: l.debitMinor, creditMinor: l.creditMinor })));
      const [u] = await tx.update(expenseClaims).set({ status: 'paid', paidOn: b.paidOn, paidReference: b.reference ?? null, paymentJournalId: je!.id, bankAccountId }).where(eq(expenseClaims.id, claim.id)).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'pay', entity: 'expense_claim', entityId: claim.id, after: u });
      return u!;
    });
    return c.json(x);
  });

  /** Anular um reembolso registado por engano: estorno do lançamento; a nota volta a "aprovada". */
  app.post('/v1/expenses/:id/reverse-payment', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo do estorno') }).parse(await body(c));
    const db = getDb();
    const { c: claim } = await load(db, actor, c.req.param('id'));
    if (claim.status !== 'paid') throw new DomainError('estado_invalido', 'A nota não está paga');
    const original = claim.paymentJournalId ? await db.query.journalEntries.findFirst({ where: eq(journalEntries.id, claim.paymentJournalId), with: { lines: true } }) : null;
    await db.transaction(async (tx) => {
      if (original) {
        const [je] = await tx.insert(journalEntries).values({ companyId: actor.companyId, date: luandaDate(new Date()), journal: 'Bancos', reference: `ES-${claim.number}-${Date.now().toString(36).toUpperCase()}`, description: `Estorno de ${original.reference}: ${note}`, source: 'expense_payment' }).returning();
        await tx.insert(journalLines).values(original.lines.map((l) => ({ entryId: je!.id, account: l.account, description: `Estorno: ${l.description}`, debitMinor: l.creditMinor, creditMinor: l.debitMinor })));
      }
      if (claim.matchId) await undoMatch(tx, actor.companyId, claim.matchId);
      await tx.update(expenseClaims).set({ status: 'approved', paidOn: null, paidReference: null, paymentJournalId: null, matchId: null }).where(eq(expenseClaims.id, claim.id));
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'reverse_payment', entity: 'expense_claim', entityId: claim.id, before: claim, after: { note } });
    });
    return c.json({ ok: true });
  });

  app.post('/v1/expenses/:id/cancel', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { c: claim } = await load(db, actor, c.req.param('id'));
    if (!['draft', 'submitted', 'rejected'].includes(claim.status)) throw new DomainError('estado_invalido', 'Notas aprovadas ou pagas não se anulam');
    if (!(actor.employeeId === claim.employeeId || actor.actorId === claim.createdBy || STAFF.includes(actor.role))) throw new DomainError('sem_permissao', 'Não pode anular esta nota', 403);
    const [x] = await db.update(expenseClaims).set({ status: 'cancelled' }).where(eq(expenseClaims.id, claim.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'cancel', entity: 'expense_claim', entityId: claim.id, before: claim });
    return c.json(x);
  });

  /** Ficheiro de transferências dos reembolsos aprovados por pagar (mesmo formato do dos salários). */
  app.get('/v1/expenses-bank-file', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const rows = await db.select({ c: expenseClaims, e: employees }).from(expenseClaims).innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .where(and(eq(expenseClaims.companyId, actor.companyId), eq(expenseClaims.status, 'approved'))).orderBy(asc(expenseClaims.number));
    const ok = rows.filter(({ e }) => e.iban && !angolanIbanProblem(e.iban));
    const csv = toCsv(['IBAN', 'Nome do beneficiário', 'Valor', 'Descritivo', 'Referência'], ok.map(({ c: x, e }) => [e.iban, e.name, csvMoney(x.totalMinor), `REEMB DESPESAS ${x.number}`, x.number]));
    return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="transferencias-reembolsos-${luandaDate(new Date())}.csv"`, 'cache-control': 'no-store' } });
  });

  return app;
}

