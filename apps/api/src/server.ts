import { serve } from '@hono/node-server';
import { getDb } from '@kianda/db';
import { buildApp } from './app.js';
import { setPushRunner } from './services/push.js';
import { setRecruitmentMailRunner } from './services/recruitment-mail.js';

/** Servidor local (desenvolvimento). Em produção a API corre em Cloudflare Workers (src/worker.ts). */
const app = buildApp({ logger: true });
// Notificações: envio depois da resposta, com a ligação da plataforma (fora da transacção do pedido).
setPushRunner((work) => work(getDb()));
setRecruitmentMailRunner((work) => work(getDb()));
const port = Number(process.env.API_PORT ?? 4000);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => console.log(`Kianda API em http://localhost:${info.port}`));
