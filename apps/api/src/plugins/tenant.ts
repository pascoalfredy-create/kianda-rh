import type { FastifyReply, FastifyRequest } from 'fastify';

export type Role = 'owner' | 'hr_admin' | 'payroll' | 'finance' | 'manager' | 'employee';

export interface SessionClaims {
  sub: string;
  companyId: string;
  role: Role;
  employeeId: string | null;
  name: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: SessionClaims;
    user: SessionClaims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    companyId: string;
    actorId: string;
    role: Role;
    employeeId: string | null;
  }
}

export const SESSION_COOKIE = 'kianda_session';

/**
 * Exige sessão válida (cookie httpOnly ou cabeçalho Authorization: Bearer).
 * A empresa vem SEMPRE do token assinado — nunca de um parâmetro enviado pelo cliente.
 */
export async function requireCompany(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'sessao_invalida', message: 'Inicie sessão para continuar.' });
  }
  req.companyId = req.user.companyId;
  req.actorId = req.user.sub;
  req.role = req.user.role;
  req.employeeId = req.user.employeeId;
}

/** Permite o acesso apenas aos perfis indicados. O proprietário (owner) tem sempre acesso. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.role !== 'owner' && !roles.includes(req.role)) {
      return reply.code(403).send({ error: 'sem_permissao', message: 'O seu perfil não permite esta operação.' });
    }
  };
}
