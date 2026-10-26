#!/usr/bin/env node
/**
 * Prepara as configurações Cloudflare para produção (corre no GitHub Actions antes do deploy):
 *  - API: substitui o id do Hyperdrive (secret KIANDA_HYPERDRIVE_ID);
 *  - Web: liga o Worker ao subdomínio (variável KIANDA_HOSTNAME, ex.: rh.seudominio.com) como custom domain.
 * Escreve wrangler.deploy.json ao lado de cada wrangler.jsonc (ficheiros gerados, fora do git).
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Remove comentários // e /* *\/ de JSONC, respeitando strings. */
function parseJsonc(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += next; i++; } else if (ch === '"') inStr = false;
    } else if (ch === '"') { inStr = true; out += ch; }
    else if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Falta a variável ${name}`); process.exit(1); }
  return v;
}

const api = parseJsonc(readFileSync('apps/api/wrangler.jsonc', 'utf8'));
api.hyperdrive = api.hyperdrive.map((h) => ({ binding: h.binding, id: need('KIANDA_HYPERDRIVE_ID') }));
writeFileSync('apps/api/wrangler.deploy.json', JSON.stringify(api, null, 2));

const web = parseJsonc(readFileSync('apps/web/wrangler.jsonc', 'utf8'));
const hostname = process.env.KIANDA_HOSTNAME;
if (hostname) {
  web.routes = [{ pattern: hostname, custom_domain: true }];
  web.workers_dev = false;
}
writeFileSync('apps/web/wrangler.deploy.json', JSON.stringify(web, null, 2));

console.log(`API → Hyperdrive configurado; Web → ${hostname ? `https://${hostname}` : 'workers.dev'}`);
