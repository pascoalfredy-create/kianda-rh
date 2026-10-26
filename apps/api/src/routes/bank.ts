import {
  angolanIbanProblem, luandaDate, matchPayments, missingProof, newRows, lineFingerprint, OBLIGATION_LABEL, parseStatement,
  type ExpectedPayment, type ObligationKind, type StatementMapping,
} from '@kianda/core';
import {
  and, asc, auditLogs, bankAccounts, bankLines, bankMatches, bankStatements, desc, eq, getDb, gte, inArray, isNull, lte, or,
  payrollLines, payrollPayments, payrollRuns, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { closedRun, obligationsFor, registerPayment, undoMatch } from '../services/payments.js';
import { DomainError } from '../services/payroll.js';

const READERS = ['finance', 'payroll'] as const;
const ledgerAccount = z.string().trim().regex(/^4\d(\.\d+)*$/, 'A conta PGC de uma conta bancária é da classe 4 (ex.: 43.1)');
const accountBody = z.object({
  name: z.string().trim().min(2, 'Indique um nome').max(80),
  bankName: z.string().trim().max(80).optional().nullable(),
  iban: z.string().trim().max(40).optional().nullable(),
  ledgerAccount,
});
const mapping = z.object({
  date: z.number().int().min(0), description: z.number().int().min(0),
  amount: z.number().int().min(0).optional(), debit: z.number().int().min(0).optional(), credit: z.number().int().min(0).optional(),
  balance: z.number().int().min(0).optional(), reference: z.number().int().min(0).optional(),
});
const statementBody = z.object({
  accountId: z.string(),
  fileName: z.string().trim().max(200).default('extracto.csv'),
  text: z.string().min(1, 'Ficheiro vazio').max(5_000_000, 'Ficheiro demasiado grande (máx. 5 MB)'),
  mapping: mapping.optional(),
  headerRow: z.number().int().min(0).optional(),
});

async function account(db: Db, companyId: string, id: string) {
  const [a] = await db.select().from(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, companyId)));
  if (!a) throw new DomainError('conta_inexistente', 'Conta bancária inexistente', 404);
  return a;
}

async function existingFingerprints(db: Db, accountId: string, from: string | null, to: string | null) {
  if (!from || !to) return new Map<string, number>();
  const rows = await db.select({ f: bankLines.fingerprint }).from(bankLines).where(and(eq(bankLines.accountId, accountId), gte(bankLines.date, from), lte(bankLines.date, to)));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.f, (m.get(r.f) ?? 0) + 1);
  return m;
}

function parse(b: z.infer<typeof statementBody>) {
  const parsed = parseStatement(b.text, { mapping: b.mapping as StatementMapping | undefined, headerRow: b.headerRow });
  return parsed;
}

/** Líquidos individuais de um processamento (para salários pagos por transferências separadas). */
async function netParts(db: Db, runIds: string[]) {
  if (!runIds.length) return new Map<string, number[]>();
  const rows = await db.select({ runId: payrollLines.runId, net: payrollLines.netMinor }).from(payrollLines).where(inArray(payrollLines.runId, runIds));
  const m = new Map<string, number[]>();
  for (const r of rows) m.set(r.runId, [...(m.get(r.runId) ?? []), r.net]);
  return m;
}

/** Pagamentos registados ainda sem movimento bancário (desta conta ou sem conta indicada). */
async function openPayments(db: Db, companyId: string, accountId: string) {
  const rows = await db.select({ p: payrollPayments, period: payrollRuns.period }).from(payrollPayments)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollPayments.runId))
    .where(and(eq(payrollPayments.companyId, companyId), isNull(payrollPayments.matchId), or(eq(payrollPayments.bankAccountId, accountId), isNull(payrollPayments.bankAccountId))))
    .orderBy(asc(payrollPayments.paidOn));
  const parts = await netParts(db, rows.filter((r) => r.p.kind === 'salaries').map((r) => r.p.runId));
  return rows.map(({ p, period }) => ({ ...p, period, parts: p.kind === 'salaries' ? parts.get(p.runId) : undefined }));
}

async function pendingDebits(db: Db, accountId: string) {
  return db.select().from(bankLines).where(and(eq(bankLines.accountId, accountId), eq(bankLines.status, 'pending'))).orderBy(asc(bankLines.date));
}

/** Aplica as correspondências automáticas e devolve as restantes sugestões. */
async function autoMatch(db: Db, actor: { companyId: string; actorId: string }, accountId: string) {
  const lines = await pendingDebits(db, accountId);
  const payments = await openPayments(db, actor.companyId, accountId);
  const expected: ExpectedPayment[] = payments.map((p) => ({ key: p.id, kind: p.kind, period: p.period, amountMinor: p.amountMinor, date: p.paidOn, reference: p.reference, parts: p.parts }));
  const matches = matchPayments(lines.map((l) => ({ id: l.id, date: l.date, description: l.description, reference: l.reference, amountMinor: l.amountMinor })), expected);
  const auto = matches.filter((m) => m.auto);
  if (auto.length) {
    await db.transaction(async (tx) => {
      for (const m of auto) {
        const [bm] = await tx.insert(bankMatches).values({ companyId: actor.companyId, accountId, kind: 'auto', rule: m.rule, createdBy: actor.actorId }).returning();
        await tx.update(bankLines).set({ status: 'matched', matchId: bm!.id }).where(inArray(bankLines.id, m.lineIds));
        await tx.update(payrollPayments).set({ matchId: bm!.id, bankAccountId: accountId }).where(eq(payrollPayments.id, m.key));
      }
    });
  }
  return { matched: auto.length, suggestions: matches.filter((m) => !m.auto) };
}

/** Obrigações fechadas e ainda não pagas, com os movimentos do extracto que lhes correspondem. */
async function unpaidWithCandidates(db: Db, companyId: string, accountId: string) {
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed'))).orderBy(desc(payrollRuns.period)).limit(12);
  const parts = await netParts(db, runs.map((r) => r.id));
  const unpaid: (ExpectedPayment & { runId: string; label: string; dueDate: string })[] = [];
  for (const run of runs) {
    for (const o of await obligationsFor(db, run)) {
      if (o.paidAt || o.amountMinor <= 0) continue;
      unpaid.push({ key: `${run.id}:${o.kind}`, runId: run.id, kind: o.kind, period: run.period, amountMinor: o.amountMinor, date: o.dueDate, dueDate: o.dueDate, reference: null, label: o.label, parts: o.kind === 'salaries' ? parts.get(run.id) : undefined });
    }
  }
  const lines = await pendingDebits(db, accountId);
  const m = matchPayments(lines.map((l) => ({ id: l.id, date: l.date, description: l.description, reference: l.reference, amountMinor: l.amountMinor })), unpaid, { before: 45, after: 60 });
  return unpaid.map((u) => ({ runId: u.runId, kind: u.kind, period: u.period, label: u.label, amountMinor: u.amountMinor, dueDate: u.dueDate, candidate: m.find((x) => x.key === u.key) ?? null }));
}

export function bankRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/bank/*', requireCompany);

  app.get('/v1/bank/accounts', requireRole(...READERS), async (c) => {
    const db = getDb();
    const companyId = c.get('actor').companyId;
    const accounts = await db.select().from(bankAccounts).where(eq(bankAccounts.companyId, companyId)).orderBy(asc(bankAccounts.createdAt));
    const out = [];
    for (const a of accounts) {
      const [last] = await db.select().from(bankStatements).where(eq(bankStatements.accountId, a.id)).orderBy(desc(bankStatements.toDate)).limit(1);
      const pending = await db.select({ id: bankLines.id }).from(bankLines).where(and(eq(bankLines.accountId, a.id), eq(bankLines.status, 'pending')));
      out.push({ ...a, lastStatementTo: last?.toDate ?? null, lastClosingBalanceMinor: last?.closingBalanceMinor ?? null, pendingLines: pending.length });
    }
    return c.json(out);
  });

  app.post('/v1/bank/accounts', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = accountBody.parse(await body(c));
    if (b.iban && angolanIbanProblem(b.iban)) throw new DomainError('iban_invalido', angolanIbanProblem(b.iban)!, 400);
    const db = getDb();
    const [a] = await db.insert(bankAccounts).values({ companyId: actor.companyId, name: b.name, bankName: b.bankName ?? null, iban: b.iban ? b.iban.replace(/\s/g, '').toUpperCase() : null, ledgerAccount: b.ledgerAccount }).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'create', entity: 'bank_account', entityId: a!.id, after: a });
    return c.json(a, 201);
  });

  app.patch('/v1/bank/accounts/:id', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = accountBody.partial().extend({ active: z.boolean().optional() }).parse(await body(c));
    if (b.iban && angolanIbanProblem(b.iban)) throw new DomainError('iban_invalido', angolanIbanProblem(b.iban)!, 400);
    const db = getDb();
    const before = await account(db, actor.companyId, c.req.param('id'));
    const [a] = await db.update(bankAccounts).set({ ...b, iban: b.iban === undefined ? undefined : b.iban ? b.iban.replace(/\s/g, '').toUpperCase() : null }).where(eq(bankAccounts.id, before.id)).returning();
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'bank_account', entityId: before.id, before, after: a });
    return c.json(a);
  });

  /** Pré-visualização: colunas detectadas, primeiras linhas, totais, verificação de saldos e repetidos. */
  app.post('/v1/bank/statements/preview', requireRole('finance'), async (c) => {
    const b = statementBody.parse(await body(c));
    const db = getDb();
    await account(db, c.get('actor').companyId, b.accountId);
    const s = parse(b);
    const { fresh, duplicates } = newRows(s.rows, await existingFingerprints(db, b.accountId, s.from, s.to));
    return c.json({
      headers: s.headers, headerRow: s.headerRow, separator: s.separator, mapping: s.mapping,
      count: s.rows.length, newCount: fresh.length, duplicates, from: s.from, to: s.to,
      inflowMinor: s.inflowMinor, outflowMinor: s.outflowMinor, balance: s.balance,
      problems: s.problems.slice(0, 20), problemCount: s.problems.length, sample: s.rows.slice(0, 12),
    });
  });

  /** Importa o extracto (só os movimentos novos) e corre a correspondência automática. */
  app.post('/v1/bank/statements', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = statementBody.parse(await body(c));
    const db = getDb();
    const acc = await account(db, actor.companyId, b.accountId);
    const s = parse(b);
    if (!s.mapping) throw new DomainError('colunas_por_indicar', s.problems[0]?.message ?? 'Indique as colunas do extracto', 400);
    if (!s.rows.length) throw new DomainError('extracto_vazio', 'Não foram encontrados movimentos no ficheiro', 400);
    const { fresh, duplicates } = newRows(s.rows, await existingFingerprints(db, acc.id, s.from, s.to));
    const statement = await db.transaction(async (tx) => {
      const [st] = await tx.insert(bankStatements).values({
        companyId: actor.companyId, accountId: acc.id, accountIban: acc.iban, fileName: b.fileName, importedBy: actor.actorId,
        fromDate: s.from, toDate: s.to, lineCount: s.rows.length, newCount: fresh.length,
        openingBalanceMinor: s.balance?.openingMinor ?? null, closingBalanceMinor: s.balance?.closingMinor ?? null, balanceOk: s.balance ? s.balance.ok : null,
      }).returning();
      for (let i = 0; i < fresh.length; i += 500) {
        await tx.insert(bankLines).values(fresh.slice(i, i + 500).map((r) => ({
          companyId: actor.companyId, accountId: acc.id, statementId: st!.id, date: r.date, description: r.description.slice(0, 500), reference: r.reference?.slice(0, 120) ?? null,
          amountMinor: r.amountMinor, balanceMinor: r.balanceMinor, fingerprint: lineFingerprint(r),
        })));
      }
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'import', entity: 'bank_statement', entityId: st!.id, after: { fileName: b.fileName, lines: s.rows.length, new: fresh.length, duplicates } });
      return st!;
    });
    const { matched } = await autoMatch(db, actor, acc.id);
    return c.json({ statementId: statement.id, count: s.rows.length, newCount: fresh.length, duplicates, matched, balance: s.balance, problemCount: s.problems.length }, 201);
  });

  app.get('/v1/bank/statements', requireRole(...READERS), async (c) => {
    const db = getDb();
    const acc = await account(db, c.get('actor').companyId, c.req.query('accountId') ?? '');
    return c.json(await db.select().from(bankStatements).where(eq(bankStatements.accountId, acc.id)).orderBy(desc(bankStatements.importedAt)));
  });

  /** Apagar um extracto importado por engano (só se nenhum movimento estiver conciliado). */
  app.delete('/v1/bank/statements/:id', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [st] = await db.select().from(bankStatements).where(and(eq(bankStatements.id, c.req.param('id')), eq(bankStatements.companyId, actor.companyId)));
    if (!st) throw new DomainError('nao_encontrado', 'Extracto inexistente', 404);
    const [matched] = await db.select({ id: bankLines.id }).from(bankLines).where(and(eq(bankLines.statementId, st.id), eq(bankLines.status, 'matched'))).limit(1);
    if (matched) throw new DomainError('extracto_conciliado', 'Há movimentos deste extracto conciliados: desfaça primeiro essas conciliações');
    await db.transaction(async (tx) => {
      await tx.delete(bankLines).where(eq(bankLines.statementId, st.id));
      await tx.delete(bankStatements).where(eq(bankStatements.id, st.id));
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'delete', entity: 'bank_statement', entityId: st.id, before: st });
    });
    return c.json({ ok: true });
  });

  /** Painel de conciliação de uma conta. */
  app.get('/v1/bank/reconciliation', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const acc = await account(db, actor.companyId, c.req.query('accountId') ?? '');
    const q = z.object({ status: z.enum(['pending', 'matched', 'out_of_scope', 'all']).default('pending'), from: z.iso.date().optional(), to: z.iso.date().optional() }).parse(c.req.query());
    const today = luandaDate(new Date());
    const where = [eq(bankLines.accountId, acc.id)];
    if (q.status !== 'all') where.push(eq(bankLines.status, q.status));
    if (q.from) where.push(gte(bankLines.date, q.from));
    if (q.to) where.push(lte(bankLines.date, q.to));
    const lines = await db.select().from(bankLines).where(and(...where)).orderBy(desc(bankLines.date)).limit(500);
    const all = await db.select({ status: bankLines.status, amount: bankLines.amountMinor }).from(bankLines).where(eq(bankLines.accountId, acc.id));
    const payments = await openPayments(db, actor.companyId, acc.id);
    const debits = await pendingDebits(db, acc.id);
    const sugg = matchPayments(debits.map((l) => ({ id: l.id, date: l.date, description: l.description, reference: l.reference, amountMinor: l.amountMinor })),
      payments.map((p) => ({ key: p.id, kind: p.kind, period: p.period, amountMinor: p.amountMinor, date: p.paidOn, reference: p.reference, parts: p.parts })));
    const matchedRows = await db.select({ m: bankMatches, p: payrollPayments, period: payrollRuns.period }).from(bankMatches)
      .innerJoin(payrollPayments, eq(payrollPayments.matchId, bankMatches.id)).innerJoin(payrollRuns, eq(payrollRuns.id, payrollPayments.runId))
      .where(eq(bankMatches.accountId, acc.id));
    const byMatch = Object.fromEntries(matchedRows.map(({ m, p, period }) => [m.id, { matchId: m.id, kind: m.kind, rule: m.rule, payment: `${OBLIGATION_LABEL[p.kind]} ${period}`, paymentAmountMinor: p.amountMinor }]));
    return c.json({
      account: acc,
      summary: {
        pending: all.filter((l) => l.status === 'pending').length,
        pendingDebits: all.filter((l) => l.status === 'pending' && l.amount < 0).length,
        matched: all.filter((l) => l.status === 'matched').length,
        outOfScope: all.filter((l) => l.status === 'out_of_scope').length,
        paymentsWithoutProof: payments.filter((p) => missingProof(p.paidOn, today)).length,
      },
      lines: lines.map((l) => ({ ...l, match: l.matchId ? byMatch[l.matchId] ?? null : null })),
      payments: payments.map((p) => ({
        id: p.id, runId: p.runId, kind: p.kind, label: OBLIGATION_LABEL[p.kind], period: p.period, paidOn: p.paidOn, amountMinor: p.amountMinor, reference: p.reference,
        withoutProof: missingProof(p.paidOn, today), suggestion: sugg.find((s) => s.key === p.id) ?? null,
      })),
      unpaid: await unpaidWithCandidates(db, actor.companyId, acc.id),
    });
  });

  app.post('/v1/bank/auto-match', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const { accountId } = z.object({ accountId: z.string() }).parse(await body(c));
    const db = getDb();
    await account(db, actor.companyId, accountId);
    const r = await autoMatch(db, actor, accountId);
    return c.json({ matched: r.matched, suggestions: r.suggestions.length });
  });

  /** Conciliação manual: um pagamento registado com um ou mais movimentos a débito do mesmo valor total. */
  app.post('/v1/bank/matches', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ accountId: z.string(), paymentId: z.string(), lineIds: z.array(z.string()).min(1, 'Escolha pelo menos um movimento').max(500) }).parse(await body(c));
    const db = getDb();
    await account(db, actor.companyId, b.accountId);
    const [p] = await db.select().from(payrollPayments).where(and(eq(payrollPayments.id, b.paymentId), eq(payrollPayments.companyId, actor.companyId)));
    if (!p) throw new DomainError('nao_encontrado', 'Pagamento inexistente', 404);
    if (p.matchId) throw new DomainError('ja_conciliado', 'Este pagamento já está conciliado');
    const lines = await db.select().from(bankLines).where(and(inArray(bankLines.id, b.lineIds), eq(bankLines.accountId, b.accountId)));
    if (lines.length !== new Set(b.lineIds).size) throw new DomainError('nao_encontrado', 'Movimento inexistente nesta conta', 404);
    if (lines.some((l) => l.status !== 'pending')) throw new DomainError('ja_conciliado', 'Há movimentos já conciliados ou ignorados');
    if (lines.some((l) => l.amountMinor >= 0)) throw new DomainError('movimento_credito', 'Só movimentos a débito (saídas) podem justificar um pagamento', 400);
    const total = lines.reduce((s, l) => s - l.amountMinor, 0);
    if (total !== p.amountMinor) throw new DomainError('valores_diferentes', `Os movimentos somam ${(total / 100).toFixed(2)} e o pagamento é de ${(p.amountMinor / 100).toFixed(2)}`, 400);
    const m = await db.transaction(async (tx) => {
      const [bm] = await tx.insert(bankMatches).values({ companyId: actor.companyId, accountId: b.accountId, kind: 'manual', rule: lines.length > 1 ? 'transferencias_individuais' : 'valor_exacto', createdBy: actor.actorId }).returning();
      await tx.update(bankLines).set({ status: 'matched', matchId: bm!.id }).where(inArray(bankLines.id, b.lineIds));
      await tx.update(payrollPayments).set({ matchId: bm!.id, bankAccountId: b.accountId }).where(eq(payrollPayments.id, p.id));
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'reconcile', entity: 'payroll_payment', entityId: p.id, after: { matchId: bm!.id, lineIds: b.lineIds } });
      return bm!;
    });
    return c.json(m, 201);
  });

  app.delete('/v1/bank/matches/:id', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [m] = await db.select().from(bankMatches).where(and(eq(bankMatches.id, c.req.param('id')), eq(bankMatches.companyId, actor.companyId)));
    if (!m) throw new DomainError('nao_encontrado', 'Conciliação inexistente', 404);
    await db.transaction(async (tx) => {
      await undoMatch(tx, actor.companyId, m.id);
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'unreconcile', entity: 'bank_match', entityId: m.id, before: m });
    });
    return c.json({ ok: true });
  });

  /** Marcar movimentos como "não é de pessoal" (comissões, recebimentos de clientes…), com nota. */
  app.post('/v1/bank/lines/ignore', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ lineIds: z.array(z.string()).min(1).max(2000), note: z.string().trim().min(2, 'Indique o motivo').max(200) }).parse(await body(c));
    const db = getDb();
    const r = await db.update(bankLines).set({ status: 'out_of_scope', note: b.note }).where(and(inArray(bankLines.id, b.lineIds), eq(bankLines.companyId, actor.companyId), eq(bankLines.status, 'pending'))).returning({ id: bankLines.id });
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'ignore', entity: 'bank_lines', entityId: r[0]?.id ?? '-', after: { count: r.length, note: b.note } });
    return c.json({ ignored: r.length });
  });

  app.post('/v1/bank/lines/:id/restore', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [l] = await db.update(bankLines).set({ status: 'pending', note: null }).where(and(eq(bankLines.id, c.req.param('id')), eq(bankLines.companyId, actor.companyId), eq(bankLines.status, 'out_of_scope'))).returning();
    if (!l) throw new DomainError('nao_encontrado', 'Movimento inexistente ou não ignorado', 404);
    return c.json(l);
  });

  /** Registar o pagamento de uma obrigação a partir do extracto: data e referência do banco, conciliação imediata. */
  app.post('/v1/bank/register-payment', requireRole('finance'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ accountId: z.string(), runId: z.string(), kind: z.enum(['salaries', 'inss', 'irt']), lineIds: z.array(z.string()).min(1).max(500) }).parse(await body(c));
    const db = getDb();
    await account(db, actor.companyId, b.accountId);
    const run = await closedRun(db, actor.companyId, b.runId);
    const lines = await db.select().from(bankLines).where(and(inArray(bankLines.id, b.lineIds), eq(bankLines.accountId, b.accountId), eq(bankLines.status, 'pending')));
    if (lines.length !== new Set(b.lineIds).size) throw new DomainError('ja_conciliado', 'Há movimentos inexistentes, já conciliados ou ignorados');
    if (lines.some((l) => l.amountMinor >= 0)) throw new DomainError('movimento_credito', 'Só movimentos a débito (saídas) podem justificar um pagamento', 400);
    const paidOn = lines.map((l) => l.date).sort().at(-1)!;
    const first = lines[0]!;
    const reference = (lines.length === 1 ? first.reference || first.description : `${lines.length} transferências`).slice(0, 80);
    const result = await registerPayment(db, actor, run, {
      kind: b.kind as ObligationKind, paidOn, reference, bankAccountId: b.accountId, expectedAmountMinor: lines.reduce((s, l) => s - l.amountMinor, 0),
    }, async (tx, payment) => {
      const [bm] = await tx.insert(bankMatches).values({ companyId: actor.companyId, accountId: b.accountId, kind: 'manual', rule: lines.length > 1 ? 'transferencias_individuais' : 'valor_exacto', createdBy: actor.actorId }).returning();
      await tx.update(bankLines).set({ status: 'matched', matchId: bm!.id }).where(inArray(bankLines.id, b.lineIds));
      await tx.update(payrollPayments).set({ matchId: bm!.id }).where(eq(payrollPayments.id, payment.id));
    });
    return c.json(result, 201);
  });

  return app;
}
