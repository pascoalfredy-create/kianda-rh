import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { getDb } from '@kianda/db';
import { licenceBlocks } from '../services/licence.js';

export type Role = 'owner' | 'hr_admin' | 'payroll' | 'finance' | 'manager' | 'employee';

export interface SessionClaims {
  sub: string;
  companyId: string;
  role: Role;
  employeeId: string | null;
  name: string;
}

/** Contexto de quem faz o pedido — sempre derivado do token assinado. */
export interface Actor {
  companyId: string;
  actorId: string;
  role: Role;
  employeeId: string | null;
  session: SessionClaims;
}

export type AppEnv = { Variables: { actor: Actor } };
export type Ctx = Context<AppEnv>;

export const SESSION_COOKIE = 'kianda_session';

export function jwtSecret(): string {
  const s = process.env.API_JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('API_JWT_SECRET em falta ou com menos de 32 caracteres');
  return 'segredo-de-desenvolvimento-nao-usar-em-producao-0123456789';
}

/**
 * Exige sessão válida (cookie httpOnly ou cabeçalho Authorization: Bearer).
 * A empresa vem SEMPRE do token assinado — nunca de um parâmetro enviado pelo cliente.
 */
export const requireCompany: MiddlewareHandler<AppEnv> = async (c, next) => {
  const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const token = getCookie(c, SESSION_COOKIE) || bearer;
  let claims: SessionClaims;
  try {
    if (!token) throw new Error('sem token');
    claims = (await verify(token, jwtSecret(), 'HS256')) as unknown as SessionClaims;
  } catch {
    return c.json({ error: 'sessao_invalida', message: 'Inicie sessão para continuar.' }, 401);
  }
  c.set('actor', { companyId: claims.companyId, actorId: claims.sub, role: claims.role, employeeId: claims.employeeId, session: claims });
  // Licença inactiva: só consulta (excepto tratar da licença).
  const blocked = await licenceBlocks(getDb(), claims.companyId, c.req.method, c.req.path);
  if (blocked) return c.json({ error: 'licenca_inactiva', message: blocked }, 402);
  await next();
};

/** Permite o acesso apenas aos perfis indicados. O proprietário (owner) tem sempre acesso. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { role } = c.get('actor');
    if (role !== 'owner' && !roles.includes(role)) return c.json({ error: 'sem_permissao', message: 'O seu perfil não permite esta operação.' }, 403);
    await next();
  };
}

/** Corpo JSON do pedido; corpo vazio ou inválido conta como objecto vazio (a validação Zod trata do resto). */
export async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

/**
 * IP real do utilizador. A API não tem endereço público: só o Worker web lhe chega, e esse Worker
 * escreve x-forwarded-for com o CF-Connecting-IP do navegador (substituindo o que o cliente enviar).
 * O cf-connecting-ip visto aqui seria o do Worker web — igual para todos os utilizadores.
 */
export function clientIp(c: Context): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('cf-connecting-ip') || 'local';
}

/**
 * Limite de tentativas FALHADAS por IP (janela deslizante, em memória).
 * Só contam respostas de erro (4xx): um login bem-sucedido não gasta tentativas.
 * Em Workers a memória é por instância: é uma primeira barreira; em produção complementar com a regra de rate limiting do Cloudflare.
 */
const hits = new Map<string, number[]>();
let rateLimitEnabled = true;
export function setRateLimitEnabled(on: boolean) { rateLimitEnabled = on; }
export function rateLimit(name: string, max: number, windowMs: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!rateLimitEnabled) return next();
    const key = `${name}:${clientIp(c)}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const wait = Math.ceil((windowMs - (now - recent[0]!)) / 60_000);
      return c.json({ error: 'demasiados_pedidos', message: `Demasiadas tentativas falhadas. Tente novamente dentro de ${wait} minuto(s).` }, 429);
    }
    await next();
    if (c.res.status >= 400 && c.res.status < 500) {
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) hits.clear();
    } else if (recent.length) {
      hits.set(key, recent);
    }
  };
}
