/**
 * Ponto de entrada em Cloudflare Workers.
 * Cada pedido tem a sua ligação ao PostgreSQL (o runtime proíbe partilhar sockets entre pedidos).
 * Este Worker NÃO tem endereço público: só o Worker web lhe chega, por service binding.
 */
import { withRequestDb } from '@kianda/db';
import { buildApp, type App } from './app.js';

interface Env {
  /** Hyperdrive (produção): pool de ligações do Cloudflare à base de dados PostgreSQL (Neon). */
  HYPERDRIVE?: { connectionString: string };
  /** Alternativa sem Hyperdrive (ex.: wrangler dev). */
  DATABASE_URL?: string;
  API_JWT_SECRET: string;
}

let app: App | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Secrets do Worker → process.env, lidos pela app (mesmo código que em Node).
    process.env.API_JWT_SECRET ??= env.API_JWT_SECRET;
    app ??= buildApp();
    const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!connectionString) return Response.json({ error: 'configuracao', message: 'Base de dados não configurada (HYPERDRIVE ou DATABASE_URL)' }, { status: 500 });
    return withRequestDb(connectionString, async () => app!.fetch(request));
  },
};
