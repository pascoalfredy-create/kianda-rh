#!/usr/bin/env node
/**
 * Prepara as configurações Cloudflare para produção (corre no GitHub Actions antes do deploy):
 *  - API: substitui o id do Hyperdrive (secret KIANDA_HYPERDRIVE_ID);
 *  - Web: liga o Worker aos domínios (variável KIANDA_HOSTNAME, ex.: rh.seudominio.com; vários separados por vírgula,
 *    o primeiro é o principal — útil para mudar de domínio sem cortar o antigo) como custom domains.
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
// Ficheiros anexados no R2 quando o bucket existe (passo anterior do CI); sem ele, ficam na base de dados.
if (process.env.KIANDA_R2 === '1') api.r2_buckets = [{ binding: 'FILES', bucket_name: 'kianda-files' }];
writeFileSync('apps/api/wrangler.deploy.json', JSON.stringify(api, null, 2));

const web = parseJsonc(readFileSync('apps/web/wrangler.jsonc', 'utf8'));
const hostnames = (process.env.KIANDA_HOSTNAME ?? '').split(',').map((h) => h.trim()).filter(Boolean);
const hostname = hostnames.join(', ');
if (hostnames.length) {
  web.routes = hostnames.map((h) => ({ pattern: h, custom_domain: true }));
  web.workers_dev = false;
}
writeFileSync('apps/web/wrangler.deploy.json', JSON.stringify(web, null, 2));

console.log(`API → Hyperdrive configurado${api.r2_buckets ? ', R2 kianda-files' : ', ficheiros na base de dados'}; Web → ${hostname ? `https://${hostname}` : 'workers.dev'}`);
