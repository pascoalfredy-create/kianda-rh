import { serve } from '@hono/node-server';
import { buildApp } from './app.js';

/** Servidor local (desenvolvimento). Em produção a API corre em Cloudflare Workers (src/worker.ts). */
const app = buildApp({ logger: true });
const port = Number(process.env.API_PORT ?? 4000);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => console.log(`Kianda API em http://localhost:${info.port}`));
