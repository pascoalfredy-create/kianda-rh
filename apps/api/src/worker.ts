/**
 * Ponto de entrada em Cloudflare Workers.
 * Cada pedido tem a sua ligação ao PostgreSQL (o runtime proíbe partilhar sockets entre pedidos).
 * Este Worker NÃO tem endereço público: só o Worker web lhe chega, por service binding.
 */
import { luandaDate } from '@kianda/core';
import { getDb, withRequestDb } from '@kianda/db';
import { buildApp, type App } from './app.js';
import { syncGatewayPayments } from './services/billing.js';
import { dailyReminders } from './services/jobs.js';

interface Env {
  /** Hyperdrive (produção): pool de ligações do Cloudflare à base de dados PostgreSQL (Neon). */
  HYPERDRIVE?: { connectionString: string };
  /** Alternativa sem Hyperdrive (ex.: wrangler dev). */
  DATABASE_URL?: string;
  API_JWT_SECRET: string;
  [key: string]: unknown;
}

/** Secrets e variáveis do Worker → process.env, lidos pela app (mesmo código que em Node). */
const SETTINGS = [
  'API_JWT_SECRET', 'APP_BASE_URL', 'KIANDA_HOSTNAME',
  'PROXYPAY_API_KEY', 'PROXYPAY_ENV', 'PROXYPAY_ENTITY', 'RESEND_API_KEY', 'MAIL_FROM', 'VENDUS_API_KEY', 'VENDUS_MODE',
];
function loadEnv(env: Env) {
  for (const k of SETTINGS) if (typeof env[k] === 'string' && env[k]) process.env[k] ??= env[k] as string;
}

let app: App | undefined;
const connection = (env: Env) => env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    loadEnv(env);
    app ??= buildApp();
    const connectionString = connection(env);
    if (!connectionString) return Response.json({ error: 'configuracao', message: 'Base de dados não configurada (HYPERDRIVE ou DATABASE_URL)' }, { status: 500 });
    return withRequestDb(connectionString, async () => app!.fetch(request));
  },

  /** Tarefas agendadas: a cada 30 min sincroniza o Multicaixa; às 07:00 UTC (08:00 em Luanda) envia os avisos de licença. */
  async scheduled(event: { cron: string }, env: Env): Promise<void> {
    loadEnv(env);
    const connectionString = connection(env);
    if (!connectionString) return;
    await withRequestDb(connectionString, async () => {
      const db = getDb();
      if (event.cron === '0 7 * * *') console.log('avisos', JSON.stringify(await dailyReminders(db, luandaDate(new Date()))));
      else console.log('multicaixa', JSON.stringify(await syncGatewayPayments(db)));
    });
  },
};
