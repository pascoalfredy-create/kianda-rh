/**
 * Regra de limite de tentativas nas rotas de autenticação, na zona Cloudflare do domínio principal.
 * Idempotente: cria ou actualiza só a regra do Kianda (ref kianda_auth_rate_limit); nunca apaga nem substitui
 * regras de outra origem. Nunca faz falhar a publicação: sem permissão ou num plano incompatível, deixa um aviso.
 *
 * Plano gratuito: uma regra, contagem por IP (+ cf.colo.id), janela de 10 s, Block durante 10 s.
 * Uso: CLOUDFLARE_API_TOKEN=… node scripts/cf-ratelimit.mjs kianda.exemplo.com
 */
const token = process.env.CLOUDFLARE_API_TOKEN, host = (process.argv[2] ?? '').trim().toLowerCase();
const REF = 'kianda_auth_rate_limit';
const PATHS = ['/api/v1/auth/login', '/api/v1/auth/login-pin', '/api/v1/auth/login/2fa', '/api/v1/auth/register', '/api/v1/auth/forgot'];
const set = `{${PATHS.map((p) => `"${p}"`).join(' ')}}`;
// Do mais preciso para o mais simples: alguns planos limitam os campos permitidos na expressão.
const EXPRESSIONS = [
  `(http.host eq "${host}" and http.request.method eq "POST" and http.request.uri.path in ${set})`,
  `(http.host eq "${host}" and http.request.uri.path in ${set})`,
  `(http.request.uri.path in ${set})`,
];
const warn = (m) => { console.log(`::warning title=Limite de tentativas (Cloudflare)::${m}`); process.exit(0); };

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, error: (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}` };
}

if (!token) warn('CLOUDFLARE_API_TOKEN em falta; regra não aplicada.');
if (!host) warn('Domínio principal em falta (KIANDA_HOSTNAME); regra não aplicada.');

// Zona: o sufixo mais longo do domínio que exista na conta (ex.: kianda.yelaperformance.com → yelaperformance.com).
const labels = host.split('.');
let zone = null;
for (let i = 0; i < labels.length - 1 && !zone; i++) {
  const r = await cf('GET', `/zones?name=${labels.slice(i).join('.')}`);
  if (r.status === 403 || r.status === 401) warn(`O token não tem acesso à leitura de zonas (${r.error}). Dê-lhe "Zone: Read" e "Zone WAF: Edit" para a zona do domínio, ou crie a regra no painel (docs/DEPLOY.md).`);
  zone = r.json.result?.[0] ?? null;
}
if (!zone) warn(`Zona Cloudflare de ${host} não encontrada nesta conta.`);

const entry = await cf('GET', `/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`);
if (entry.status === 403 || entry.status === 401) warn(`O token não pode ler as regras de limite da zona ${zone.name} (${entry.error}). Dê-lhe "Zone WAF: Edit" ou crie a regra no painel (docs/DEPLOY.md).`);
const existing = entry.status === 200 ? entry.json.result.rules ?? [] : [];
const others = existing.filter((r) => r.ref !== REF);
const current = existing.find((r) => r.ref === REF);
if (others.length && !current) {
  // Sem saber o plano, não arriscamos substituir uma regra criada à mão (o gratuito só admite uma).
  const r = others.map((o) => `«${o.description || o.id}»`).join(', ');
  console.log(`::notice title=Limite de tentativas (Cloudflare)::A zona ${zone.name} já tem regra(s) de limite: ${r}. A regra do Kianda não foi criada para não a(s) substituir.`);
  process.exit(0);
}

for (const expression of EXPRESSIONS) {
  const rule = { ref: REF, description: 'Kianda — autenticação (limite de tentativas)', expression, action: 'block', enabled: true,
    ratelimit: { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 5, mitigation_timeout: 10 } };
  const same = current && current.expression === expression && current.action === 'block' && current.ratelimit?.period === 10 && current.ratelimit?.requests_per_period === 5 && current.ratelimit?.mitigation_timeout === 10;
  if (same) { console.log(`Limite de tentativas: regra já aplicada em ${zone.name} (sem alterações).`); process.exit(0); }
  const r = await cf('PUT', `/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`, { rules: [...others, rule] });
  if (r.status === 200) { console.log(`::notice title=Limite de tentativas (Cloudflare)::Regra aplicada em ${zone.name}: 5 pedidos / 10 s por IP nas rotas de autenticação → Block 10 s.`); console.log(`Expressão: ${expression}`); process.exit(0); }
  if (r.status === 403 || r.status === 401) warn(`O token não pode alterar as regras da zona ${zone.name} (${r.error}). Dê-lhe "Zone WAF: Edit" ou crie a regra no painel (docs/DEPLOY.md).`);
  console.log(`Expressão recusada (${r.error}); a tentar uma mais simples…`);
}
warn('A Cloudflare recusou todas as variantes da regra neste plano. Crie-a no painel (docs/DEPLOY.md).');
