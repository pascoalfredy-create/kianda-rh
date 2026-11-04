import { expect, request, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

export const API = 'http://localhost:4000';
export const PASSWORD = 'NavegadorSeguro2026abc';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://kianda:kianda@127.0.0.1:5433/kianda';

let pool: pg.Pool | null = null;
/** SQL directo só para preparar cenários que não têm ecrã (licença paga, orçamento aprovado). */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  return (await pool.query(text, params)).rows as T[];
}

let seq = 0;
const unique = () => `${Date.now()}${process.pid % 1000}${seq++}`;

export interface Company { id: string; email: string; token: string; name: string }
type Modules = ('hr' | 'modeling' | 'valuation')[];

/** Regista uma empresa nova pela API (cada teste trabalha isolado). */
export async function registerCompany(opts: { name?: string; modules?: Modules; sectors?: string[] } = {}): Promise<Company> {
  const api = await request.newContext({ baseURL: API });
  const id = unique(), name = opts.name ?? `Empresa E2E ${id.slice(-6)}`, email = `dona.${id}@e2e.kianda.test`;
  const modules = opts.modules ?? ['hr'];
  const res = await api.post('/v1/auth/register', { data: { acceptTerms: true,
    company: { name, sector: 'services', nif: id.slice(-10).padStart(10, '0') }, name: 'Dona E2E', email, password: PASSWORD, modules,
    ...(modules.includes('modeling') ? { modelingPlan: { key: 'pme', cycle: 'monthly', primarySector: 'servicos', sectors: opts.sectors ?? ['servicos', 'comercio'] } } : {}),
  } });
  expect(res.status(), await res.text()).toBe(201);
  const token = /kianda_session=([^;]+)/.exec(res.headers()['set-cookie'] ?? '')![1]!;
  const body = await res.json();
  // Preparação de uma empresa sintética já confirmada; o circuito do token tem testes próprios.
  await sql('update users set email_verified_at=now() where id=$1 and company_id=$2', [body.user.id, body.company.id]);
  await api.dispose();
  return { id: body.company.id, email, token, name };
}

/** Pedido autenticado à API (com o cookie de sessão de quem o faz). */
export async function apiAs<T = any>(token: string, method: string, path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { cookie: `kianda_session=${token}` } });
  const res = await api.fetch(path, { method, ...(data === undefined ? {} : { data }) });
  const text = await res.text();
  await api.dispose();
  let body: unknown = text; try { body = JSON.parse(text); } catch { /* binário ou vazio */ }
  return { status: res.status(), body: body as T };
}

/** Cria um utilizador na empresa e devolve a sua sessão. */
export async function addUser(owner: Company, name: string, role = 'finance', employeeId?: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${unique()}@e2e.kianda.test`;
  const created = await apiAs(owner.token, 'POST', '/v1/users', { name, email, password: PASSWORD, role, ...(employeeId ? { employeeId } : {}) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const api = await request.newContext({ baseURL: API });
  const login = await api.post('/v1/auth/login', { data: { email, password: PASSWORD } });
  const token = /kianda_session=([^;]+)/.exec(login.headers()['set-cookie'] ?? '')![1]!;
  await api.dispose();
  return { id: created.body.id as string, email, token };
}

/** Entra sem passar pelo formulário (o login pelo formulário tem o seu próprio teste). */
export async function signIn(context: BrowserContext, token: string) {
  await context.clearCookies();
  await context.addCookies([{ name: 'kianda_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
}

/** Erros de JavaScript da página (ignora só recursos externos, como as fontes, que podem falhar na rede do CI). */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

export async function closePool() { await pool?.end(); pool = null; }

/** Valora: abre um ecrã pelo menu lateral, abrindo antes o grupo recolhido que o contém. */
export async function valoraGo(page: Page, view: string) {
  const link = page.locator(`#nav a[data-v="${view}"]`);
  if (!(await link.isVisible())) await page.locator('#nav .nav-group', { has: page.locator(`a[data-v="${view}"]`) }).locator('.nav-group-toggle').click();
  await link.click();
  await openMaps(page);
}

/** Abrir explicitamente os mapas que um cenário de negócio pretende consultar/editar. */
export async function openMaps(page: Page) {
  for (const map of await page.locator('details.map-disclosure:not([open])').all()) {
    const summary = map.locator('summary').first();
    if (await summary.isVisible()) await summary.click();
  }
}
