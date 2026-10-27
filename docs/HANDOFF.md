# Kianda RH — documento de passagem (handoff)

> Para um novo agente/programador continuar o trabalho. Leia isto primeiro, depois `docs/ROADMAP.md` e `docs/DEPLOY.md`.
> Última actualização: 27/10/2026 (entrega 16 publicada).

## 1. O que é

Plataforma SaaS de RH para empresas angolanas (estilo Factorial), com processamento salarial, obrigações (IRT/INSS), finanças de pessoal em **PGC Angola (Decreto n.º 82/2001)**, conciliação bancária, despesas, cessação, documentos, recrutamento, desempenho e portal do colaborador. Vendida por licença com escalões.

- **Dono do produto:** Pascoal Frederico (CFO, especialista em PGC Angola). Fala português (de Angola, pré-AO90 nos textos da app: "acção", "efectivo", "direcção").
- **Produção:** https://kianda.yelaperformance.com
- **Repositório:** `pascoalfredy-create/kianda-rh` (GitHub), branch `main`. Cada push para `main` testa e publica (GitHub Actions → Cloudflare).

## 2. Regras de trabalho com o dono

- Responder **sempre em português**, tom directo de consultor sénior ("modo 10x").
- Classificação contabilística **só PGC Angola**: **classe 6 = proveitos**, **classe 7 = custos** (o inverso do POC/SNC português). Nunca usar POC/SNC/IFRS/brasileiro.
- Ele responde "Avançar" para cada entrega. Ritmo: construir → testar (unitários + API + browser) → commit → push → confirmar CI → resumir.
- Commits terminam com as linhas de atribuição pedidas pela sessão.
- Tokens/palavras-passe não passam pelo chat (excepto se ele pedir expressamente).

## 3. Stack e estrutura (monorepo pnpm)

| Pasta | O quê |
| --- | --- |
| `packages/core` | Motor puro TypeScript (sem I/O): salários, IRT, INSS, férias, assiduidade, PGC, balancete, conciliação, despesas, cessação, documentos, talento, licenças, TOTP, sectores (`sectors.ts`: regimes, subsídios, conformidade). **Valores monetários em cêntimos inteiros** (`kz(1000)` = 100000). Regras legais por ano em `src/packs/ao-2026.ts` (com lista `toValidate`). |
| `packages/db` | Drizzle 0.45 + pg. `src/schema.ts`, migrações SQL em `migrations/` (0000–0017), `scripts/seed.ts` (empresa demo), `scripts/migrate.ts`, `scripts/platform-admins.ts`. |
| `apps/api` | Hono 4 (corre em Node local e em Cloudflare Workers). Rotas em `src/routes/*.ts`, serviços em `src/services/`. Zod 4 para validação. Testes de API em `test/api.test.ts` (Vitest, base Postgres real). |
| `apps/web` | Next 16 + React 19 (App Router) via OpenNext Cloudflare. Páginas autenticadas em `app/(app)/`; públicas: `login`, `registo`, `termos`, `acesso/[token]`, `carreiras/[company]`, `verificar/[code]`. |

Versões: TypeScript 5.9.3, Vitest 4.0.5, Hono 4.13, Zod 4.6, Next 16.4, React 19.3, OpenNext 1.20.

## 4. Arquitectura e convenções importantes

- **Multi-empresa (tenant):** a empresa vem SEMPRE do JWT de sessão (`requireCompany` em `apps/api/src/plugins/tenant.ts`); todas as consultas filtram por `companyId`. Ainda **não** há Row-Level Security no Postgres (planeado na entrega 18).
- **Licença:** `requireCompany` bloqueia escritas (HTTP 402 `licenca_inactiva`) quando a licença não está activa, excepto `/v1/billing`, `/v1/auth/`, `/v1/platform`. Lógica em `apps/api/src/services/licence.ts` + `packages/core/src/licensing.ts`.
- **Perfis:** `owner`, `hr_admin`, `payroll`, `finance`, `manager`, `employee`. `requireRole(...)` — o `owner` passa sempre. Chefia decide sobre a equipa directa (`managerId`); ninguém decide sobre si próprio (excepto owner).
- **Middlewares Hono** registados por caminho (`app.use('/v1/x/*', requireCompany)`), nunca `'*'` em sub-apps.
- **BD por pedido:** `withRequestDb` (AsyncLocalStorage); operadores SQL importados de `@kianda/db` (uma só instância do drizzle).
- **Web → API:** route handler `app/api/[...path]/route.ts` reencaminha para a API (binding `API` em Cloudflare, `API_URL` em local). Páginas usam `api()` / `currentUser()` de `lib/api.ts`; cliente usa `send()` / `useMutation()` de `lib/client.ts`.
- **Next:** não exportar constantes de ficheiros `page.tsx` (usar `status.ts`/`types.ts` ao lado). Constantes partilhadas não vêm de módulos `'use client'`. Protecção de páginas no layout do grupo `(app)` (sem `proxy.ts`).
- **Hora de Luanda (UTC+1):** `luandaDate()` do core.
- **Lançamentos contabilísticos:** nunca se apagam; anula-se com estorno. Referências: `PS-AAAAMM` (processamento), `PG-…` (pagamentos), `ND-AAAA-NNNN` (despesas), `DOC-AAAA-NNNN` (documentos), `PF-AAAA-NNNN` (pedidos de pagamento da licença).
- **Auditoria:** tabela `audit_logs` em todas as operações sensíveis.

## 5. Produção e publicação

- **Cloudflare:** Worker `kianda-web` (único público, domínio `kianda.yelaperformance.com`) e Worker `kianda-api` (sem endereço público, só via service binding `API`). Conta `9d30c22314c1728b12b9fc0946c3356a`.
- **Base de dados:** Neon Postgres (Frankfurt) via **Hyperdrive** (id `139b36ef3c0e47f3b348311b60693147`, cache desligada).
- **CI** (`.github/workflows/ci.yml`): job de testes (Postgres de serviço) → em `main` com `vars.KIANDA_DEPLOY == 'true'`: valida secrets → migra → administradores da plataforma → seed (se `KIANDA_SEED_DEMO == 'true'`) → `scripts/cf-prepare.mjs` → deploy API + `wrangler secret bulk` → build/deploy web → verifica `/api/health` e login das 3 contas demo.
- **Secrets GitHub:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KIANDA_HYPERDRIVE_ID`, `KIANDA_DATABASE_URL`, `KIANDA_DATABASE_CA_CERT` (opcional), `KIANDA_JWT_SECRET`, `KIANDA_SEED_OWNER_PASSWORD`.
- **Variáveis GitHub:** `KIANDA_DEPLOY=true`, `KIANDA_SEED_DEMO=true` (pôr `false` antes de clientes reais), `KIANDA_HOSTNAME`, `KIANDA_PLATFORM_ADMINS=pascoalfredy@gmail.com`.
- Nesta sessão de agente os **logs do Actions e a área de secrets estavam bloqueados (403)**; os erros do CI lêem-se pelas anotações (`scripts/ci-run.sh` emite `::error::`) com `gh api repos/…/check-runs/<id>/annotations`. `gh run list` funciona.

## 6. Contas

- **Demo (empresa Kwanza Logística, código `KWANZA` ou o gerado):** `admin@kwanzalog.co.ao` (proprietária), `edson@kwanzalog.co.ao` (chefia), `joana@kwanzalog.co.ao` (colaboradora). Palavra-passe = secret `KIANDA_SEED_OWNER_PASSWORD` (local: `Kianda2026demo`).
- **Administrador da plataforma:** `pascoalfredy@gmail.com` na empresa interna "Kianda RH — Plataforma" (NIF interno `PLATAFORMA`, código `KIANDA`, excluída da lista de clientes). Palavra-passe inicial = a das contas demo; deve mudar em "A minha conta".

## 7. Desenvolvimento local

```bash
pnpm install
bash /tmp/pgup.sh            # (no ambiente do agente) arranca Postgres em 127.0.0.1:5433; pára sozinho — reiniciar se os testes da API forem "skipped"
export DATABASE_URL=postgresql://kianda:kianda@127.0.0.1:5433/kianda
export API_JWT_SECRET="segredo-de-desenvolvimento-local-com-mais-de-32"
pnpm db:migrate && SEED_OWNER_PASSWORD=Kianda2026demo pnpm db:seed
pnpm --filter @kianda/core build && pnpm --filter @kianda/db build   # a API consome os dist
pnpm -r typecheck && pnpm -r test                                    # core 101 testes, API 93 testes
(cd apps/api && npx tsx src/server.ts)                               # :4000
(cd apps/web && npx next build && API_URL=http://localhost:4000 npx next start -p 3000)
```

- Matar servidores: `fuser -k 3000/tcp 4000/tcp` (não usar `pkill -f "next start"`: mata a própria shell).
- **Migrações novas:** `cd packages/db && npx drizzle-kit generate --name <nome>`. Se o drizzle-kit pedir confirmação interactiva (tabela que sai e outra que entra), dividir em duas migrações.
- **Testes no browser:** Playwright global (`NODE_PATH=$(npm root -g) node script.js`); scripts de exemplo em `/tmp/e2e` (efémeros).
- Rede da sessão do agente: só registos de pacotes/GitHub; `kianda.yelaperformance.com` não é alcançável a partir do agente (validar produção pelo CI).

## 8. Estado — o que está feito

Entregas **1–13** (produto) e **14–16** (SaaS), todas publicadas. Resumo em `docs/ROADMAP.md`. Destaques:

- Processamento: IRT Grupo A 2026, INSS 3%+8%, subsídios (férias/Natal, proporcionais), horas extra (50%/75%, blocos de 15 min), faltas, variáveis, mês incompleto proporcional, recibos com hash.
- Contas PGC sugeridas (parametrizáveis): 72.2.1–72.2.4, 72.5.1, 34.3 (IRT), 34.9.1 (INSS), 36.1.2, 36.3, 36.9, 43.1, 75.2 (despesas), 72.8 (ajudas de custo e compensações por cessação), 63 (compensação por falta de aviso do trabalhador).
- Licenças: escalões 0–100 = 99 999 Kz/mês; 101–250 = 200 000; 251–500 = 380 000; 501–1500 = 550 000; >1500 à medida. Semestral −10%, anual −20%. **Colaborador extra: 3 000 Kz, pagamento único.** Experimental **7 dias**. Tolerância 7 dias → modo de consulta.
- Acessos: convites por ligação (WhatsApp/SMS/email), PIN com código da empresa, 2FA TOTP, bloqueio após 5 falhas.
- Sectores (entrega 16): tabelas `work_schedules`, `allowance_types`, `employee_allowances`; `employees.scheduleId/scheduleAnchor`. Rotas em `apps/api/src/routes/sector.ts` (`/v1/sector`, `/v1/schedules`, `/v1/allowance-types`, `/v1/work-regime/:employeeId`, `/v1/employee-allowances/:id`, `/v1/compliance`). O processamento (`services/payroll.ts`) junta os subsídios como `otherEarnings` com o código do catálogo (vão para a conta de subsídios no fecho). Páginas `/sector`, `/conformidade` e separador "Horário e subsídios" na ficha.

## 9. Próximos passos (por ordem)

1. **Entrega 17 — Pagamentos automáticos:** referência Multicaixa via gateway (ProxyPay/AppyPay/EMIS) com activação automática; integração com software de facturação certificado AGT (hoje o Kianda só emite pró-formas; o n.º da factura certificada regista-se na consola). Envio de email transaccional (convites/recuperação por email automático — hoje a ligação é partilhada manualmente).
2. **Entrega 18 — Blindagem:** Row-Level Security no Postgres, cópias e exportação por empresa, eliminação a pedido (Lei n.º 22/11), domínio próprio da marca.
3. **Pendentes do dono antes de clientes reais:** rodar `KIANDA_JWT_SECRET` (gerado fora do chat); `KIANDA_SEED_DEMO=false`; regra de rate limiting no WAF da Cloudflare para `/api/v1/auth/login*`; preencher dados bancários/suporte na consola; validação jurídica da lista `toValidate` (em especial regras numéricas da cessação — Lei n.º 12/23 arts. 286.º, 289.º, 293.º, 295.º, 305.º, 307.º–311.º — e textos dos contratos); formatos oficiais do banco/AGT/INSS (hoje CSV genérico); armazenamento de ficheiros (R2) para CVs e recibos de despesas (hoje ligações).

## 10. Armadilhas já resolvidas (não repetir)

- Fastify gera código com `new Function` → proibido nos Workers → por isso Hono.
- Instalar `@cloudflare/workers-types` duplicou o drizzle → operadores re-exportados de `@kianda/db`.
- `proxy.ts` do Next corre em Node e é experimental em Cloudflare → protecção no layout.
- Limite de tentativas partilhado atrás do binding → conta por IP real (`x-forwarded-for` escrito pelo web a partir de `cf-connecting-ip`) e só falhas.
- Estado React em sequência rápida (avaliações): usar actualizações funcionais `setX((s) => …)`.
- Referências de lançamento únicas: depois de um estorno, novo pagamento leva sufixo `-2`, `-3`.
- Testes que criam dados partilhados (ex.: parâmetros da plataforma) devem limpar no `beforeAll`.
