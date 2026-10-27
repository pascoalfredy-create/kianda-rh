import {
  AGT_MAP_COLUMNS, AGT_MONEY_COLUMNS, AGT_SIMPLE_COLUMNS, AGT_SIMPLE_MONEY_COLUMNS, agtMapRow, agtMunicipality, agtProvince, agtSimpleRow, angolanIbanProblem, applyBps, inssSheetRow, bankAmount, bankDescription, bankFromIban, csvMoney, getPack, luandaDate, nbaFromIban, toCsv,
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
   * Mapa Mensal de Remunerações (AGT) nos templates oficiais: completo "IRT A2.1" (32 colunas, por omissão) ou simplificado
   * (?template=simple, 15 colunas). NIF do contribuinte em A1, período em A2 (rótulos em B1/B2), cabeçalho nas linhas 3–4, dados a partir da 5;
   * todos os trabalhadores do processamento. ?format=xlsx|csv|json.
   */
  app.get('/v1/payroll-runs/:id/maps/agt', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const pack = getPack('AO', Number(run.period.slice(0, 4)));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const issues: { employee: string; problem: string }[] = [];
    const full = rows.map(({ l, e }) => {
      const provName = e.province ?? co?.province ?? null;
      const prov = agtProvince(provName);
      const rawMunicipality = e.municipality ?? (e.province && e.province !== co?.province ? null : co?.municipality) ?? null;
      const municipality = prov ? agtMunicipality(prov.code, rawMunicipality) : null;
      const nif = (e.nif ?? e.biNumber ?? '').replace(/\s/g, '').toUpperCase();
      if (!e.nif && !e.biNumber) issues.push({ employee: e.name, problem: 'sem NIF (nem n.º do BI)' });
      else if (!e.nif) issues.push({ employee: e.name, problem: 'sem NIF — usado o n.º do BI (o NIF das pessoas singulares angolanas é o n.º do BI; estrangeiros precisam de NIF próprio)' });
      if (!e.inssNumber) issues.push({ employee: e.name, problem: 'sem n.º de Segurança Social' });
      if (!prov) issues.push({ employee: e.name, problem: provName ? `província "${provName}" sem sigla AGT` : 'sem província (nem na ficha nem na sede da empresa)' });
      else if (prov.provisional) issues.push({ employee: e.name, problem: `província ${provName}: o template da AGT ainda usa as 18 províncias — vai como ${prov.code}` });
      if (prov && !municipality) issues.push({ employee: e.name, problem: rawMunicipality ? `município "${rawMunicipality}" não consta da lista da AGT para ${prov.code}` : 'sem município' });
      return agtMapRow({
        nif, name: e.name, inssNumber: e.inssNumber ?? '', province: prov?.code ?? '', municipality: municipality ?? (rawMunicipality ?? '').toUpperCase(),
        breakdown: l.breakdown as { code: string; kind: string; amountMinor: number }[], grossMinor: l.grossMinor, inssBaseMinor: l.inssBaseMinor,
        inssEmployeeMinor: l.inssEmployeeMinor, irtMinor: l.irtMinor, irtTaxableMinor: taxableFromBreakdown(l, run.period),
        allowanceExemptionMinor: pack.irt.allowanceExemptionMinor,
      });
    });
    const simple = c.req.query('template') === 'simple';
    const columns: readonly string[] = simple ? AGT_SIMPLE_COLUMNS : AGT_MAP_COLUMNS;
    const money = simple ? AGT_SIMPLE_MONEY_COLUMNS : AGT_MONEY_COLUMNS;
    const data = simple ? full.map((r) => agtSimpleRow(r, pack.irt.allowanceExemptionMinor)) : full;
    const totalIrt = full.reduce((s, r) => s + Number(r[AGT_MAP_COLUMNS.indexOf('IRT Apurado')]), 0);
    const format = c.req.query('format') ?? 'json';
    const file = `mapa-remuneracoes-${simple ? 'simplificado' : 'A2.1'}-${co?.nif ?? ''}-${run.period}`;
    if (format === 'xlsx') {
      const width = columns.length;
      const blank = () => Array<string | number>(width).fill('');
      const r1 = blank(); r1[0] = co?.nif ?? ''; r1[1] = 'NIF do Contribuinte';
      const r2 = blank(); r2[0] = run.period; r2[1] = 'Período (AAAA-MM)';
      const r3 = blank();
      const r4 = blank();
      let merges: string[];
      if (simple) {
        columns.forEach((h, i) => { r3[i] = h; });
        merges = columns.map((_, i) => { const l = colLetter(i); return `${l}3:${l}4`; });
      } else {
        AGT_MAP_COLUMNS.forEach((h, i) => { const top = i >= 12 && i <= 13 || i >= 24; (top ? r3 : r4)[i] = h; });
        r3[7] = 'Subsídios Não Sujeitos a IRT (Art. 2º do CIRT)';
        r3[14] = 'Subsídios Sujeitos a IRT';
        merges = ['M3:M4', 'N3:N4', 'O3:X3', ...['Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF'].map((l) => `${l}3:${l}4`)];
      }
      const body = data.map((r) => r.map((v, i) => (money.has(i) ? Number(v) / 100 : v)));
      return xlsxResponse(xlsx([{
        name: 'Mapa de Remunerações', rows: [r1, r2, r3, r4, ...body], boldRows: [2, 3], freezeRows: 4, merges,
        widths: columns.map((h, i) => (i === 1 ? 32 : i === 0 || i === 2 ? 19 : Math.max(13, Math.min(20, h.length)))),
      }]), `${file}.xlsx`);
    }
    if (format === 'csv') {
      return csvResponse(toCsv([...columns], data.map((r) => r.map((v, i) => (money.has(i) ? csvMoney(Number(v)) : v)))), `${file}.csv`);
    }
    return c.json({ period: run.period, template: simple ? 'simple' : 'A2.1', columns, rows: data, count: data.length, totalIrtMinor: totalIrt, issues });
  });

  /**
   * Folha de Remuneração Normal no formato do INSS Virtual (?format=xlsx): contribuinte (nome, NIS, NIF), trabalhadores
   * (inscrição, nome, categoria, salário base, remunerações adicionais, total) e totais com as parcelas de 3% e 8%.
   * JSON e CSV mantêm a lista de controlo por trabalhador.
   */
  app.get('/v1/payroll-runs/:id/maps/inss', requireRole(...READERS), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const run = await closedRun(db, actor.companyId, c.req.param('id'));
    const [co] = await db.select().from(companies).where(eq(companies.id, actor.companyId));
    const pack = getPack('AO', Number(run.period.slice(0, 4)));
    const rows = await db.select({ l: payrollLines, e: employees }).from(payrollLines).innerJoin(employees, eq(employees.id, payrollLines.employeeId)).where(eq(payrollLines.runId, run.id)).orderBy(asc(employees.number));
    const data = rows.map(({ l, e }) => ({ number: e.number, name: e.name, jobTitle: e.jobTitle, inssNumber: e.inssNumber ?? '', base: l.inssBaseMinor, employee: l.inssEmployeeMinor, employer: l.inssEmployerMinor, total: l.inssEmployeeMinor + l.inssEmployerMinor, sheet: inssSheetRow({ breakdown: l.breakdown as { code: string; kind: string; amountMinor: number }[], inssBaseMinor: l.inssBaseMinor }) }));
    const missing = data.filter((d) => !d.inssNumber).map((d) => d.name);
    if (c.req.query('format') === 'xlsx') {
      const kz = (m: number) => m / 100;
      const subject = data.filter((d) => d.sheet.totalMinor > 0);
      const tBase = subject.reduce((s, d) => s + d.sheet.baseMinor, 0);
      const tAdd = subject.reduce((s, d) => s + d.sheet.additionalMinor, 0);
      const part = (bps: number) => [applyBps(tBase, bps), applyBps(tAdd, bps)] as const;
      const [eb, ea] = part(pack.inss.employeeBps);
      const [cb, ca] = part(pack.inss.employerBps);
      const month = new Date(`${run.period}-01T12:00:00Z`).toLocaleDateString('pt-PT', { month: 'long', timeZone: 'UTC' });
      const sheet = [
        ['Folha de Remuneração Normal'], [` Mês de referência: ${month}/${run.period.slice(0, 4)}`], [],
        ['Informações do Contribuinte'], ['Nome:', co?.name ?? ''], ['NIS:', co?.inssNumber ?? ''], ['NIF:', co?.nif ?? ''], [],
        ['Informações dos Trabalhadores'],
        ['Inscrição Inss', 'Nome', 'Categoria Profissional', 'Salário Base', 'Remunerações Adicionais', 'Total'],
        ...subject.map((d) => [d.inssNumber, d.name.toUpperCase(), d.jobTitle.toUpperCase(), kz(d.sheet.baseMinor), kz(d.sheet.additionalMinor), kz(d.sheet.totalMinor)]),
        [],
        ['Total de Remunerações', '', '', kz(tBase), kz(tAdd), kz(tBase + tAdd)],
        [`Total Parcela Segurado ${pack.inss.employeeBps / 100}%`, '', '', kz(eb), kz(ea), kz(eb + ea)],
        [`Total Parcela Contribuinte ${pack.inss.employerBps / 100}%`, '', '', kz(cb), kz(ca), kz(cb + ca)],
        ['Total de Contribuições', '', '', '', '', kz(eb + ea + cb + ca)],
      ];
      return xlsxResponse(xlsx([{ name: 'Folha', rows: sheet, boldRows: [0, 3, 8, 9], widths: [24, 40, 28, 16, 24, 16], numberFormat: '#,##0.00' }]), `FolhaDeRemuneracao-${run.period.replace('-', '_')}.xlsx`);
    }
    if (c.req.query('format') === 'csv') {
      return csvResponse(toCsv(
        ['N.º', 'Nome', 'N.º Segurança Social', 'Base de incidência', 'Trabalhador (3%)', 'Entidade empregadora (8%)', 'Total'],
        [...data.map((d) => [d.number, d.name, d.inssNumber, csvMoney(d.base), csvMoney(d.employee), csvMoney(d.employer), csvMoney(d.total)]),
          ['', `TOTAL — contribuinte ${co?.inssNumber ?? '(sem n.º INSS da empresa)'}`, '', csvMoney(data.reduce((s, d) => s + d.base, 0)), csvMoney(data.reduce((s, d) => s + d.employee, 0)), csvMoney(data.reduce((s, d) => s + d.employer, 0)), csvMoney(data.reduce((s, d) => s + d.total, 0))]],
      ), `folha-inss-${run.period}.csv`);
    }
    return c.json({ period: run.period, companyInssNumber: co?.inssNumber ?? null, rows: data.map(({ sheet, ...d }) => ({ ...d, salaryMinor: sheet.baseMinor, additionalMinor: sheet.additionalMinor })), missingInssNumber: missing });
  });

  /**
   * Ficheiro de transferência dos salários.
   * profile: nib (por omissão — Excel NOME, NIB, VALOR, a regra comum dos bancos), generic (CSV: IBAN; Nome; Valor; Descritivo; Referência), bfa (Excel para o Conversor/BFA Net Empresas:
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
    const profile = z.enum(['nib', 'generic', 'bfa', 'bai']).catch('nib').parse(c.req.query('profile') ?? co?.bankFileProfile ?? 'nib');
    const byBank = new Map<string, number>();
    for (const { e } of ok) { const b = bankFromIban(e.iban)!; byBank.set(b.short, (byBank.get(b.short) ?? 0) + 1); }
    if (c.req.query('format') === 'json') {
      return c.json({ period: run.period, profile, count: ok.length, totalMinor: ok.reduce((s, r) => s + r.l.netMinor, 0), excluded, banks: Object.fromEntries(byBank) });
    }
    const mm = run.period.slice(5, 7);
    const yyyy = run.period.slice(0, 4);
    const desc = `SALARIO ${mm}/${yyyy}`;
    const stamp = run.period.replace('-', '');
    if (profile === 'nib') {
      // Regra comum dos bancos angolanos: NOME, NIB (21 algarismos), VALOR.
      return xlsxResponse(xlsx([{
        name: 'Salarios', header: true, widths: [40, 26, 16],
        rows: [['NOME', 'NIB', 'VALOR'], ...ok.map(({ e, l }) => [e.name.toUpperCase(), nbaFromIban(e.iban!), l.netMinor / 100])],
      }]), `salarios-${stamp}.xlsx`);
    }
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

function colLetter(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
