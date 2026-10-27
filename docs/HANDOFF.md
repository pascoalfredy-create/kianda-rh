# Kianda RH — documento de passagem (handoff)

> Para um novo agente/programador continuar o trabalho. Leia isto primeiro, depois `docs/ROADMAP.md` e `docs/DEPLOY.md`.
> Última actualização: 27/10/2026 (entrega 19 publicada — revisão pela LGT e adiantamentos).

## 1. O que é

Plataforma SaaS de RH para empresas angolanas (estilo Factorial), com processamento salarial, obrigações (IRT/INSS), finanças de pessoal em **PGC Angola (Decreto n.º 82/2001)**, conciliação bancária, despesas, cessação, documentos, recrutamento, desempenho e portal do colaborador. Vendida por licença com escalões.

- **Dono do produto:** Pascoal Frederico (CFO e contabilista — decide ele próprio as questões fiscais/contabilísticas; especialista em PGC Angola). Faz software de gestão, não software de facturação (por isso a factura certificada vai para o Vendus). Fala português (de Angola, pré-AO90 nos textos da app: "acção", "efectivo", "direcção").
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
| `packages/db` | Drizzle 0.45 + pg. `src/schema.ts`, migrações SQL em `migrations/` (0000–0022), `scripts/seed.ts` (empresa demo), `scripts/migrate.ts`, `scripts/platform-admins.ts`. |
| `apps/api` | Hono 4 (corre em Node local e em Cloudflare Workers). Rotas em `src/routes/*.ts`, serviços em `src/services/`. Zod 4 para validação. Testes de API em `test/api.test.ts` (Vitest, base Postgres real). |
| `apps/web` | Next 16 + React 19 (App Router) via OpenNext Cloudflare. Páginas autenticadas em `app/(app)/`; públicas: `login`, `registo`, `termos`, `acesso/[token]`, `carreiras/[company]`, `verificar/[code]`. |

Versões: TypeScript 5.9.3, Vitest 4.0.5, Hono 4.13, Zod 4.6, Next 16.4, React 19.3, OpenNext 1.20.

## 4. Arquitectura e convenções importantes

- **Multi-empresa (tenant):** a empresa vem SEMPRE do JWT de sessão (`requireCompany` em `apps/api/src/plugins/tenant.ts`); as consultas filtram por `companyId` **e** a base de dados impõe-no: `requireCompany` corre o pedido em `withTenant` (`@kianda/db`) — transacção com `SET LOCAL ROLE kianda_app` + `app.company_id` (RLS, migração 0019). Um erro no pedido desfaz a transacção. `/v1/platform/*` corre sem RLS (só administradores). **Regras para tabelas novas:** se tem `company_id`, a migração tem de incluir `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY empresa … USING (company_id = kianda_tenant()) WITH CHECK (…)`, e a tabela entra em `COMPANY_TABLES_PURGE_ORDER` (`services/privacy.ts`); tabelas-filhas sem `company_id` usam `coluna IN (SELECT id FROM tabela_mãe)`. Os testes de guarda da entrega 18 falham se isto for esquecido. Numeração global entre empresas tem de passar por função `SECURITY DEFINER` (ex.: `kianda_next_payment_number`).
- **Licença:** `requireCompany` bloqueia escritas (HTTP 402 `licenca_inactiva`) quando a licença não está activa, excepto `/v1/billing`, `/v1/auth/`, `/v1/platform`. Lógica em `apps/api/src/services/licence.ts` + `packages/core/src/licensing.ts`.
- **Perfis:** `owner`, `hr_admin`, `payroll`, `finance`, `manager`, `employee`. `requireRole(...)` — o `owner` passa sempre. Chefia decide sobre a equipa directa (`managerId`); ninguém decide sobre si próprio (excepto owner).
- **Middlewares Hono** registados por caminho (`app.use('/v1/x/*', requireCompany)`), nunca `'*'` em sub-apps.
- **BD por pedido:** `withRequestDb` (AsyncLocalStorage); operadores SQL importados de `@kianda/db` (uma só instância do drizzle).
- **Web → API:** route handler `app/api/[...path]/route.ts` reencaminha para a API (binding `API` em Cloudflare, `API_URL` em local). Páginas usam `api()` / `currentUser()` de `lib/api.ts`; cliente usa `send()` / `useMutation()` de `lib/client.ts`.
- **Next:** não exportar constantes de ficheiros `page.tsx` (usar `status.ts`/`types.ts` ao lado). Constantes partilhadas não vêm de módulos `'use client'`. Protecção de páginas no layout do grupo `(app)` (sem `proxy.ts`).
- **Hora de Luanda (UTC+1):** `luandaDate()` do core.
- **Regras laborais:** revistas contra o texto oficial da LGT (Lei n.º 12/23, MAPTSS 2024) — cada regra confirmada está em `AO_2026.confirmed` com o artigo; `toValidate` ficou só com pontos fiscais/segurança social e de interpretação. Ao mudar uma regra numérica, sobe a versão do pacote (`AO-2026.2`) e acrescenta um teste em `packages/core/test/lgt.test.ts` com o artigo.
- **Adiantamentos (`salary_advances`):** `routes/advances.ts` + `core/advances.ts`. Prestações = `payroll_variables` com `advance_id` (não se apagam à mão). Limites do art. 248.º validados no pedido e na aprovação (exposição de outros adiantamentos por mês).
- **Lançamentos contabilísticos:** nunca se apagam; anula-se com estorno. Referências: `PS-AAAAMM` (processamento), `PG-…` (pagamentos), `ND-AAAA-NNNN` (despesas), `DOC-AAAA-NNNN` (documentos), `PF-AAAA-NNNN` (pedidos de pagamento da licença).
- **Auditoria:** tabela `audit_logs` em todas as operações sensíveis.

## 5. Produção e publicação

- **Cloudflare:** Worker `kianda-web` (único público, domínio `kianda.yelaperformance.com`) e Worker `kianda-api` (sem endereço público, só via service binding `API`). Conta `9d30c22314c1728b12b9fc0946c3356a`.
- **Base de dados:** Neon Postgres (Frankfurt) via **Hyperdrive** (id `139b36ef3c0e47f3b348311b60693147`, cache desligada).
- **CI** (`.github/workflows/ci.yml`): job de testes (Postgres de serviço) → em `main` com `vars.KIANDA_DEPLOY == 'true'`: valida secrets → migra → administradores da plataforma → seed (se `KIANDA_SEED_DEMO == 'true'`) → `scripts/cf-prepare.mjs` → deploy API + `wrangler secret bulk` → build/deploy web → verifica `/api/health` e login das 3 contas demo.
- **Secrets GitHub:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `KIANDA_HYPERDRIVE_ID`, `KIANDA_DATABASE_URL`, `KIANDA_DATABASE_CA_CERT` (opcional), `KIANDA_JWT_SECRET`, `KIANDA_SEED_OWNER_PASSWORD`.
- **Variáveis GitHub:** `KIANDA_DEPLOY=true`, `KIANDA_SEED_DEMO=true` (pôr `false` antes de clientes reais), `KIANDA_HOSTNAME`, `KIANDA_PLATFORM_ADMINS=pascoalfredy@gmail.com`; integrações (opcionais): `KIANDA_PROXYPAY_ENV`, `KIANDA_PROXYPAY_ENTITY`, `KIANDA_MAIL_FROM`, `KIANDA_VENDUS_MODE`.
- **Secrets opcionais (integrações):** `KIANDA_PROXYPAY_API_KEY`, `KIANDA_RESEND_API_KEY`, `KIANDA_VENDUS_API_KEY`.
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
pnpm -r typecheck && pnpm -r test                                    # core 113 testes, API 107 testes
(cd apps/api && npx tsx src/server.ts)                               # :4000
(cd apps/web && npx next build && API_URL=http://localhost:4000 npx next start -p 3000)
```

- Matar servidores: `fuser -k 3000/tcp 4000/tcp` (não usar `pkill -f "next start"`: mata a própria shell).
- **Migrações novas:** `cd packages/db && npx drizzle-kit generate --name <nome>`. Se o drizzle-kit pedir confirmação interactiva (tabela que sai e outra que entra), dividir em duas migrações.
- **Testes no browser:** Playwright global (`NODE_PATH=$(npm root -g) node script.js`); scripts de exemplo em `/tmp/e2e` (efémeros).
- Rede da sessão do agente: só registos de pacotes/GitHub; `kianda.yelaperformance.com` não é alcançável a partir do agente (validar produção pelo CI).

## 8. Estado — o que está feito

Entregas **1–13** (produto), **14–18** (SaaS) **19** (revisão LGT + adiantamentos) e **20** (ficheiros + recuperação por email), todas publicadas. Resumo em `docs/ROADMAP.md`. Destaques:

- Processamento: IRT Grupo A 2026, INSS 3%+8%, subsídios (férias/Natal, proporcionais), horas extra (50%/75%, blocos de 15 min), faltas, variáveis, mês incompleto proporcional, recibos com hash.
- Contas PGC sugeridas (parametrizáveis): 72.2.1–72.2.4, 72.5.1, 34.3 (IRT), 34.9.1 (INSS), 36.1.2, 36.3, 36.9, 43.1, 75.2 (despesas), 72.8 (ajudas de custo e compensações por cessação), 63 (compensação por falta de aviso do trabalhador).
- Licenças: escalões 0–100 = 99 999 Kz/mês; 101–250 = 200 000; 251–500 = 380 000; 501–1500 = 550 000; >1500 à medida. Semestral −10%, anual −20%. **Colaborador extra: 3 000 Kz, pagamento único.** Experimental **7 dias**. Tolerância 7 dias → modo de consulta.
- Acessos: convites por ligação (WhatsApp/SMS/email), PIN com código da empresa, 2FA TOTP, bloqueio após 5 falhas.
- Sectores (entrega 16): tabelas `work_schedules`, `allowance_types`, `employee_allowances`; `employees.scheduleId/scheduleAnchor`. Rotas em `apps/api/src/routes/sector.ts` (`/v1/sector`, `/v1/schedules`, `/v1/allowance-types`, `/v1/work-regime/:employeeId`, `/v1/employee-allowances/:id`, `/v1/compliance`). O processamento (`services/payroll.ts`) junta os subsídios como `otherEarnings` com o código do catálogo (vão para a conta de subsídios no fecho). Páginas `/sector`, `/conformidade` e separador "Horário e subsídios" na ficha.
- Integrações (entrega 17): `apps/api/src/services/integrations.ts` (clientes ProxyPay, Resend, Vendus — só activos com o secret), `services/billing.ts` (referência, confirmação, factura, recibo, `applyGatewayPayment` idempotente por `gateway_events`, `syncGatewayPayments`), `services/mail.ts` (modelo HTML, registo em `outbound_emails`, `dedupeKey`), `services/jobs.ts` (avisos de licença). Webhook público `POST /v1/public/gateway/proxypay` (passa pelo proxy `/api` da web, que reencaminha `x-signature`). Worker com `scheduled()` e crons em `apps/api/wrangler.jsonc`. Nos testes, os fornecedores são simulados substituindo `globalThis.fetch` (ver bloco da entrega 17); para testar no browser use `PROXYPAY_BASE_URL`/`RESEND_BASE_URL`/`VENDUS_BASE_URL` a apontar para um servidor falso. Configuração em `docs/DEPLOY.md` (secção Integrações).

- Ficheiros (entrega 20): tabelas `files` (metadados) e `file_blobs` (conteúdo quando não há R2), ambas com RLS. `services/storage.ts` (`setObjectStore`, `storeFile`, `readFileData`, `removeFiles`; o Worker liga o R2 pelo binding `FILES`), rotas em `routes/files.ts` (`GET/POST /v1/files?entity=&entityId=`, `GET/DELETE /v1/files/:id`; o envio é o corpo em bruto, sem multipart). Entidades: `employee`, `employee_document`, `absence`, `expense_claim` — regras de acesso em `fileAccess`. Componente web `components/attachments.tsx`. O CI cria o bucket `kianda-files` e só então junta o binding (`KIANDA_R2=1` → `scripts/cf-prepare.mjs`).
- Recuperação por email (entrega 20): `POST /v1/auth/forgot` cria ligações `access_links.kind = 'self_reset'` (1 h); a aceitação troca só a palavra-passe e mantém a 2FA (`completeLogin(..., secondFactorDone=false)`). Página `/recuperar`.

## 9. Próximos passos (por ordem)

1. **Fase seguinte (a definir com o dono):** formatos oficiais (ficheiro bancário de salários por banco, declarações AGT/INSS), CVs dos candidatos como ficheiros, app móvel (PWA) do colaborador, relatórios para gestão.
2. **Pendentes do dono antes de clientes reais:** definir `KIANDA_BACKUP_PASSPHRASE` (cópias); empresa em constituição — depois actualizar dados de facturação/IBAN na consola e o domínio próprio (`KIANDA_HOSTNAME` com vários domínios); contratar ProxyPay, Resend e Cegid Vendus e definir os secrets (ver DEPLOY.md) — o Vendus só é necessário quando a facturação electrónica geral entrar em vigor (Janeiro); enquadramento de IVA/isenção das licenças a definir pelo dono; rodar `KIANDA_JWT_SECRET` (gerado fora do chat); `KIANDA_SEED_DEMO=false`; regra de rate limiting no WAF da Cloudflare para `/api/v1/auth/login*`; preencher dados bancários/suporte na consola; validação jurídica da lista `toValidate` (em especial regras numéricas da cessação — Lei n.º 12/23 arts. 286.º, 289.º, 293.º, 295.º, 305.º, 307.º–311.º — e textos dos contratos); formatos oficiais do banco/AGT/INSS (hoje CSV genérico).

## 10. Armadilhas já resolvidas (não repetir)

- Fastify gera código com `new Function` → proibido nos Workers → por isso Hono.
- Instalar `@cloudflare/workers-types` duplicou o drizzle → operadores re-exportados de `@kianda/db`.
- `proxy.ts` do Next corre em Node e é experimental em Cloudflare → protecção no layout.
- Limite de tentativas partilhado atrás do binding → conta por IP real (`x-forwarded-for` escrito pelo web a partir de `cf-connecting-ip`) e só falhas.
- Estado React em sequência rápida (avaliações): usar actualizações funcionais `setX((s) => …)`.
- Referências de lançamento únicas: depois de um estorno, novo pagamento leva sufixo `-2`, `-3`.
- Testes que criam dados partilhados (ex.: parâmetros da plataforma) devem limpar no `beforeAll`.

### Regra de cálculo manual (27/10/2026)
Decisão do contabilista: onde a LGT não fecha a regra, o motor **não calcula** — conta os dias, avisa no processamento ("CÁLCULO MANUAL") e o valor é lançado nas variáveis:
- Licença de maternidade (suspensão do salário) → variável "Desconto na remuneração" (código `CORTE`, abono negativo que reduz INSS/IRT).
- Feriado trabalhado (art. 200.º, n.º 2) → "Outro abono".
- Vésperas de 24 e 31 de Dezembro (art. 199.º) → aviso em Dezembro; horas devidas lançadas à mão.
- Subsídios em ano com suspensão (art. 238.º, n.º 3) → aviso; ajuste manual.
O core mantém `suspendedDays`, `holidayWorkDays` e `familyEveMinutes` (testados), mas a API não os usa.
