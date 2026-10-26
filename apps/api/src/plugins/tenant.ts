import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    companyId: string;
    actorId: string;
  }
}

/**
 * Resolve a empresa (tenant) do pedido.
 * NESTA FASE: lê o cabeçalho `x-company-id` (desenvolvimento).
 * PRÓXIMO PASSO: substituir por sessão autenticada (JWT) e verificação de perfil — ver docs/ROADMAP.md.
 */
export async function requireCompany(req: FastifyRequest, reply: FastifyReply) {
  const companyId = req.headers['x-company-id'];
  if (typeof companyId !== 'string' || !companyId) {
    return reply.code(401).send({ error: 'empresa_nao_identificada', message: 'Indique a empresa (cabeçalho x-company-id).' });
  }
  req.companyId = companyId;
  req.actorId = typeof req.headers['x-actor-id'] === 'string' ? (req.headers['x-actor-id'] as string) : 'system';
}
