import {
  AGT_MAP_COLUMNS, AGT_MONEY_COLUMNS, agtMapRow, agtProvince, angolanIbanProblem, bankAmount, bankDescription, bankFromIban, csvMoney, getPack, luandaDate, nbaFromIban, toCsv,
} from '@kianda/core';
import { xlsx, xlsxResponse } from '../lib/xlsx.js';
import {
  and, asc, auditLogs, companies, desc, employees, eq, getDb, journalEntries, journalLines, payrollLines, payrollPayments, payrollRuns,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { closedRun, KIND_CODE, obligationsFor, registerPayment, undoMatch } from '../services/payments.js';

const READERS = ['payroll', 'finance', 'hr_admin'] as const;
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
    const b = z.object({ kind: z.enum(['salaries', 'inss', 'irt']), paidOn: z.iso.date(), reference: z.string().trim().max(80).optional().nullable(), bankAccountId: z.string().optional().nullable() }).parse(await body(c));
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    return c.json(await registerPayment(db, actor, run, b), 201);
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
      if (p.matchId) await undoMatch(tx, actor.companyId, p.matchId);
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


  /**
   * Mapa Mensal de Remunerações (AGT, Portal do Contribuinte → IRT → Mapa de Remunerações → Upload de Ficheiro).
   * 31 colunas pela ordem do template; inclui todos os trabalhadores do processamento. ?format=xlsx|csv|json.
   */
  app.get('/v1/payroll-runs/:id/maps/agt', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const issues: { employee: string; problem: string }[] = [];
    const data = rows.map(({ l, e }) => {
      const provName = e.province ?? co?.province ?? null;
      const prov = agtProvince(provName);
      const municipality = e.municipality ?? (e.province && e.province !== co?.province ? null : co?.municipality) ?? '';
      const nif = (e.nif ?? e.biNumber ?? '').replace(/\s/g, '').toUpperCase();
      if (!e.nif && !e.biNumber) issues.push({ employee: e.name, problem: 'sem NIF (nem n.º do BI)' });
      else if (!e.nif) issues.push({ employee: e.name, problem: 'sem NIF — usado o n.º do BI (o NIF das pessoas singulares angolanas é o n.º do BI; estrangeiros precisam de NIF próprio)' });
      if (!e.inssNumber) issues.push({ employee: e.name, problem: 'sem n.º de Segurança Social' });
      if (!prov) issues.push({ employee: e.name, problem: provName ? `província "${provName}" sem sigla AGT` : 'sem província (nem na ficha nem na sede da empresa)' });
      else if (prov.provisional) issues.push({ employee: e.name, problem: `província ${provName}: sigla ${prov.code} provisória (nova divisão administrativa) — confirme no portal` });
      if (!municipality) issues.push({ employee: e.name, problem: 'sem município' });
      return agtMapRow({
        nif, name: e.name, inssNumber: e.inssNumber ?? '', province: prov?.code ?? '', municipality,
        breakdown: l.breakdown as { code: string; kind: string; amountMinor: number }[], grossMinor: l.grossMinor, inssBaseMinor: l.inssBaseMinor,
        inssEmployeeMinor: l.inssEmployeeMinor, irtMinor: l.irtMinor, irtTaxableMinor: taxableFromBreakdown(l, run.period),
      });
    });
    const irtCol = AGT_MAP_COLUMNS.indexOf('IRT Apurado');
    const totalIrt = data.reduce((s, r) => s + Number(r[irtCol]), 0);
    const format = c.req.query('format') ?? 'json';
    const file = `mapa-remuneracoes-agt-${co?.nif ?? ''}-${run.period}`;
    if (format === 'xlsx') {
      const sheetRows = [[...AGT_MAP_COLUMNS], ...data.map((r) => r.map((v, i) => (AGT_MONEY_COLUMNS.has(i) ? Number(v) / 100 : v)))];
      return xlsxResponse(xlsx([{ name: 'Mapa de Remunerações', rows: sheetRows, header: true, widths: AGT_MAP_COLUMNS.map((c, i) => (i === 1 ? 32 : Math.max(12, Math.min(22, c.length)))) }]), `${file}.xlsx`);
    }
    if (format === 'csv') {
      return csvResponse(toCsv([...AGT_MAP_COLUMNS], data.map((r) => r.map((v, i) => (AGT_MONEY_COLUMNS.has(i) ? csvMoney(Number(v)) : v)))), `${file}.csv`);
    }
    return c.json({ period: run.period, columns: AGT_MAP_COLUMNS, rows: data, count: data.length, totalIrtMinor: totalIrt, issues });
  });

  /** Folha de remunerações para o INSS. JSON, CSV ou Excel (?format=xlsx). */
  app.get('/v1/payroll-runs/:id/maps/inss', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const data = rows.map(({ l, e }) => ({ number: e.number, name: e.name, inssNumber: e.inssNumber ?? '', base: l.inssBaseMinor, employee: l.inssEmployeeMinor, employer: l.inssEmployerMinor, total: l.inssEmployeeMinor + l.inssEmployerMinor }));
    const missing = data.filter((d) => !d.inssNumber).map((d) => d.name);
    if (c.req.query('format') === 'xlsx') {
      const kz = (m: number) => m / 100;
      return xlsxResponse(xlsx([{
        name: 'Folha de Remunerações', header: true, widths: [8, 32, 18, 18, 16, 20, 14],
        rows: [
          ['N.º', 'Nome', 'N.º Segurança Social', 'Base de incidência', 'Trabalhador (3%)', 'Entidade empregadora (8%)', 'Total'],
          ...data.map((d) => [d.number, d.name, d.inssNumber, kz(d.base), kz(d.employee), kz(d.employer), kz(d.total)]),
          ['', `TOTAL — contribuinte ${co?.inssNumber ?? '(sem n.º INSS da empresa)'} — ${run.period}`, '', kz(data.reduce((s, d) => s + d.base, 0)), kz(data.reduce((s, d) => s + d.employee, 0)), kz(data.reduce((s, d) => s + d.employer, 0)), kz(data.reduce((s, d) => s + d.total, 0))],
        ],
      }]), `folha-inss-${co?.inssNumber ?? ''}-${run.period}.xlsx`);
    }
    if (c.req.query('format') === 'csv') {
      return csvResponse(toCsv(
        ['N.º', 'Nome', 'N.º Segurança Social', 'Base de incidência', 'Trabalhador (3%)', 'Entidade empregadora (8%)', 'Total'],
        [...data.map((d) => [d.number, d.name, d.inssNumber, csvMoney(d.base), csvMoney(d.employee), csvMoney(d.employer), csvMoney(d.total)]),
          ['', `TOTAL — contribuinte ${co?.inssNumber ?? '(sem n.º INSS da empresa)'}`, '', csvMoney(data.reduce((s, d) => s + d.base, 0)), csvMoney(data.reduce((s, d) => s + d.employee, 0)), csvMoney(data.reduce((s, d) => s + d.employer, 0)), csvMoney(data.reduce((s, d) => s + d.total, 0))]],
      ), `folha-inss-${run.period}.csv`);
    }
    return c.json({ period: run.period, companyInssNumber: co?.inssNumber ?? null, rows: data, missingInssNumber: missing });
  });

  /**
   * Ficheiro de transferência dos salários.
   * profile: generic (CSV: IBAN; Nome; Valor; Descritivo; Referência), bfa (Excel para o Conversor/BFA Net Empresas:
   * Nome do Beneficiário, IBAN, Valor 1250000,00, Descrição até 20 caracteres — sem cabeçalho nem totais),
   * bai (Excel para o Serviço de Pagamento em Massa — PSX interbancário: N.º de ordem, NIB, banco, BIC, cidade, país, valor).
   * Por omissão, o perfil escolhido nas Definições.
   */
  app.get('/v1/payroll-runs/:id/bank-file', requireRole('finance', 'payroll'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const ok = rows.filter(({ e, l }) => e.iban && !angolanIbanProblem(e.iban) && l.netMinor > 0);
    const excluded = rows.filter((r) => !ok.includes(r)).map(({ e, l }) => ({ name: e.name, netMinor: l.netMinor, reason: !e.iban ? 'sem IBAN' : angolanIbanProblem(e.iban) ? 'IBAN inválido' : 'líquido zero' }));
    const profile = z.enum(['generic', 'bfa', 'bai']).catch('generic').parse(c.req.query('profile') ?? co?.bankFileProfile ?? 'generic');
    const byBank = new Map<string, number>();
    for (const { e } of ok) { const b = bankFromIban(e.iban)!; byBank.set(b.short, (byBank.get(b.short) ?? 0) + 1); }
    if (c.req.query('format') === 'json') {
      return c.json({ period: run.period, profile, count: ok.length, totalMinor: ok.reduce((s, r) => s + r.l.netMinor, 0), excluded, banks: Object.fromEntries(byBank) });
    }
    const mm = run.period.slice(5, 7);
    const yyyy = run.period.slice(0, 4);
    const desc = `SALARIO ${mm}/${yyyy}`;
    const stamp = run.period.replace('-', '');
    if (profile === 'bfa') {
      // Regras do BFA: sem cabeçalhos/totais; uma só moeda; valor texto com vírgula e 2 decimais.
      return xlsxResponse(xlsx([{ name: 'Lote', widths: [40, 30, 16, 22], rows: ok.map(({ e, l }) => [e.name.slice(0, 40), e.iban!.replace(/\s/g, '').toUpperCase(), bankAmount(l.netMinor), bankDescription(desc)]) }]), `bfa-salarios-${stamp}.xlsx`);
    }
    if (profile === 'bai') {
      return xlsxResponse(xlsx([{
        name: 'PSX', header: true, widths: [10, 26, 34, 14, 12, 10, 16],
        rows: [
          ['N.º de Ordem', 'NIB do Beneficiário', 'Nome do Banco do Beneficiário', 'BIC', 'Cidade', 'País', 'Valor'],
          ...ok.map(({ e, l }, i) => { const b = bankFromIban(e.iban)!; return [i + 1, nbaFromIban(e.iban!), b.name, b.bic ?? '', 'LUANDA', 'ANGOLA', bankAmount(l.netMinor)]; }),
        ],
      }]), `bai-salarios-${stamp}.xlsx`);
    }
    return csvResponse(toCsv(['IBAN', 'Nome do beneficiário', 'Valor', 'Descritivo', 'Referência'],
      ok.map(({ e, l }) => [e.iban, e.name, csvMoney(l.netMinor), desc, `${stamp}-${e.number}`])), `transferencias-salarios-${run.period}.csv`);
  });

  return app;
}
