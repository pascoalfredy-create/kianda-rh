# Kianda RH + Kianda Integra + Kianda Valora — documento de passagem

> Para quem continua o trabalho (agente ou programador). Leia isto primeiro; depois `docs/MODULOS-LICENCAS.md` (comercial), `docs/INTEGRA_MODULE.md` (Modelagem), secção Valora de `docs/MODULOS-LICENCAS.md` e `docs/DEPLOY.md` (produção).
> **Última actualização: 02/11/2026** — alinhado com o código e com a produção no commit `576c165` (PR #29) e com a limpeza de documentação que se lhe seguiu.
> **Fonte de verdade: o código e os testes.** Se um documento divergir do código, corrija o documento, nunca o contrário sem decisão do dono. A tabela comercial existe só em `MODULOS-LICENCAS.md`; um teste (`packages/core/test/docs-coherence.test.ts`) falha se ela divergir do código.

## 1. O que é

Uma conta, um repositório e uma base de dados para três módulos com licenças próprias:

- **Kianda RH** — gestão de pessoas e processamento salarial para Angola (IRT, INSS, LGT), obrigações, finanças de pessoal em **PGC Angola (Decreto n.º 82/2001)**, conciliação, despesas, cessação, documentos, recrutamento, desempenho, portal e app móvel (PWA).
- **Kianda Integra · Modelagem Financeira** — projectos de investimento e avaliação de empresas nos 8 sectores (mineração, petróleo, agro, comércio, serviços, indústria, imobiliário, tecnologia): demonstrações projectadas, DCF, crédito, cenários, 8 relatórios em PDF, versões aprovadas, análise de balancetes históricos (também de outros ERP) e importação opcional dos custos com pessoal do RH.

- **Kianda Valora · Análise e Avaliação** — análise financeira de uma entidade (própria empresa, participada ou alvo): demonstrações PGC Angola, orçamento, tesouraria, controlo orçamental mensal, rácios e avaliação (DCF, múltiplos, activos), relatórios PDF/Word/Excel. Interface aprovada em `apps/web/valuation/prototype.html`, montada por `scripts/build-valuation-ui.mjs` (ajustes explícitos que falham se o texto mudar; regenerar com `pnpm --filter @kianda/web valuation:generate`); ligação à API em `apps/web/valuation/adapter.js`; servida em `/valora`.

- **Dono do produto:** Pascoal Frederico — CFO e contabilista; decide ele próprio as questões fiscais e contabilísticas; especialista em PGC Angola. Faz software de gestão, não de facturação (a factura certificada vai para o Vendus).
- **Produção:** https://kianda.yelaperformance.com · **Repositório:** `pascoalfredy-create/kianda-rh`, ramo `main`.

## 2. Regras do dono (preservar)

- Responder **sempre em português de Angola**, directo, «modo 10x» de consultor sénior. Na aplicação, grafia pré-AO90 já usada: projecto, sector, efectivo, acção, direcção.
- **PGC Angola: classe 6 = proveitos; classe 7 = custos** (o inverso do POC/SNC). Nunca usar POC/SNC/IFRS/brasileiro.
- Onde a LGT não fecha a regra, o motor não calcula: cálculo manual com aviso (secção 12). IRT e INSS validados pelo dono.
- **Não redesenhar layouts nem reorganizar ecrãs sem pedido.** A página pública verde (PR #23) foi aprovada; isso não autoriza mudar o resto. O Integra usa o protótipo aprovado, montado sem redesenho.
- RH e Modelagem: mesmo repositório, conta e base de dados; licenças e permissões próprias; ambos visíveis no catálogo comum, sem conceder acesso ao não contratado. Não criar outra base, repositório ou serviço (Supabase, etc.).
- Importação RH → Integra: **opcional**, accionada pelo utilizador, cópia com origem e data; alterações posteriores no RH não mudam o modelo.
- Projectos ≠ sectores ≠ utilizadores (limites distintos).
- Clientes do Integra exportam **só PDF**. Excel só para o ID configurado em `KIANDA_MODELING_OWNER_USER_ID` com estatuto de administrador da plataforma.
- Importações de documentos: manter cancelar/remover/substituir e a protecção contra respostas assíncronas antigas.
- Não prometer indexação no Google, OCR completo, finanças offline nem protecção absoluta contra cópias/capturas.
- Ritmo: o dono responde «Avançar» a cada entrega. Fluxo: ramo → alterações → testes (unitários, API com Postgres, navegador) → PR → CI verde → merge squash → publicação automática → confirmar CI e smoke → resumo curto.
- Segredos: não passam pelo chat, salvo pedido expresso do dono; nunca em ficheiros, commits ou logs. Commits terminam com as linhas de atribuição pedidas pela sessão.

## 3. Estado actual (02/11/2026)

- Produção no commit `576c165` (PR #29), publicada com sucesso: testes, tipos, build, **E2E**, migrações, API, web e smoke público. `/api/health` → `{"status":"ok","packs":["AO-2026"]}`.
- Testes: **core 291, API 279, web 174** (com Postgres no CI) + **21 E2E** no navegador. A contagem do core inclui o teste de coerência da documentação.
- Última migração: **0042_valuation_align_trial_limits** (avaliações do Valora abertas com a primeira tabela alinhadas aos limites actuais, com auditoria).

**Entregas recentes (ver também `docs/ROADMAP.md`):**

| PR | O quê |
| --- | --- |
| #22 | Preços actuais (anual −15%), avaliação de 7 dias sem exportação, protótipo verde isolado. Migração 0036 (ilimitado mensal). |
| #23 | Página pública verde aprovada; planos num diálogo; ligação de registo com módulo/plano/ciclo pré-seleccionados (`/registo?modulo=modeling&plano=corporate&ciclo=annual`). |
| #24 | Integra: **Versões** (aprovação pelo proprietário com destino, consulta só leitura com verificação do VAL, PDF da versão, duplicar a partir de versão), **Importar do RH** junto a 72, **participantes por projecto** (migração 0037, 404 fora do âmbito). Corrigido teste dependente da data. |
| #25 | Cópia de segurança diária com **teste de restauro** e impressão digital da frase no registo. |
| #26 | **Testes no navegador** (`apps/e2e`) obrigatórios para publicar. |
| #27/#28 | Limites reais da Cloudflare documentados; `scripts/cf-ratelimit.mjs` no deploy (idempotente). |
| #29 | Procedimento manual «Administração — repor verificação em dois passos» (só administradores da plataforma, sem tocar na palavra-passe, com auditoria). |
| #30/#31 | Documentação alinhada com o código (teste de coerência dos preços); regra de limite de tentativas activa. |
| #32 | **Ponto com localização** (entrega 25 do RH): locais com raio, regra off/registar/alertar/bloquear, GPS só na marcação (também offline), quiosque com QR/código rotativo, excepções na Assiduidade. Motor em `packages/core/src/geofence.ts`; rotas em `apps/api/src/routes/workplaces.ts` e `attendance.ts`; página `/locais`, ecrã público `/quiosque/[token]`. |
| #33 | **Kianda Valora** (3.º módulo): licença própria (avaliação no registo; activação e limites pela Plataforma), análises por empresa no servidor com revisões, membros com edição/consulta, custos com o pessoal (72) do RH, exportações PDF/Word/Excel só com licença paga, nomes de ficheiro em ASCII (o Chromium ignora acentos). |
| #34/#35 | **Planos do Valora** por análises activas (primeira versão; 32.900 a 129.900 Kz/mês; extras 10.000 Kz), pedido de pagamento `valuation_subscription` confirmado pela plataforma, plano no registo (`/registo?modulo=valuation&plano=pme`). Migração 0040. |
| seguinte | **Valora: limites por segmento** (Essencial 3 · PME / Grupo 10 · Corporate 20 · Profissional 40 · Ilimitado; preços iguais), regra sem rotação (migração 0041 `restored_at`), Valora na página pública (módulos, planos, perguntas, metadados) e no smoke da publicação. |

**Feito em 01–02/11/2026 (configuração de produção):** `KIANDA_BACKUP_PASSPHRASE` definido (impressão digital `33ec1a54`; cópia diária às 02:17 de Luanda com teste de restauro); `KIANDA_JWT_SECRET` rodado; `KIANDA_SEED_DEMO=false` (a empresa demo «Kwanza Logística» e as 3 contas continuam na base — eliminar pela consola se deixarem de servir); 2FA da conta de administrador reposta a pedido do dono (execução `41401754941`; não repetir como teste); **regra de limite de tentativas activa na Cloudflare** desde 02/11 (token `kianda-rh-deploy` com «Zone WAF Rules · Edit»; zona `yelaperformance.com`, 5 pedidos/10 s por IP nas rotas de autenticação → Block 10 s; reaplicada de forma idempotente em cada publicação por `scripts/cf-ratelimit.mjs`).

**Próximas entregas acordadas (fechar lacunas face ao Factorial, uma de cada vez):** acolhimento e saída (listas de tarefas), aceitação electrónica de documentos no portal, notificações no telemóvel, planeamento de turnos. Reconhecimento facial e terminais biométricos ficam para depois (equipamento e risco jurídico).

**Feito pelo dono (confirmado em 02/11/2026):** IBAN do Banco Atlântico configurado na consola (Plataforma Kianda); os pedidos de pagamento mostram as instruções de transferência. Ficheiros anexados em R2 (`kianda-files`) activo.

**Pendentes (do dono)** — estado lido do registo da publicação de 02/11/2026: o Worker só tem `API_JWT_SECRET` e `APP_BASE_URL`; ProxyPay, Resend, Vendus e `KIANDA_MODELING_OWNER_USER_ID` estão vazios.
1. Confirmar na consola o email e o telefone de suporte (aparecem na licença e no Valora).
2. Opcional: `KIANDA_MODELING_OWNER_USER_ID` (sem ela ninguém exporta Excel da Modelagem).
3. Contratar ProxyPay, Resend e Vendus e definir os secrets (DEPLOY.md); Vendus quando a facturação electrónica geral entrar em vigor. Enquadramento de IVA das licenças. Domínio próprio (`KIANDA_HOSTNAME`).
4. Validação jurídica de `AO_2026.toValidate` (em especial cessação, Lei n.º 12/23) e textos dos contratos; termos ainda versão de trabalho.
5. **AO-2027:** registar o pacote quando o OGE 2027 for publicado — sem ele, o processamento de Janeiro de 2027 é recusado.

**Cópias de segurança — o que está e não está provado:** cada cópia é cifrada, decifrada e lida com `pg_restore --list` antes de ser guardada (30 dias, artefacto privado). Não é um ensaio de restauro completo numa segunda base. O backup PostgreSQL **não inclui** os ficheiros do R2 (`kianda-files`).

## 4. Comercial, avaliação e exportações

A tabela de preços e as regras de planos, sectores, utilizadores, período experimental e exportações estão em **`docs/MODULOS-LICENCAS.md`** (única cópia, verificada por teste). Resumo: RH por faixas fixas de colaboradores activos (sem extras); Integra por projectos activos, com sectores e 5 utilizadores por plano (extras a 35.000 Kz/mês); semestral −10%, anual −15%; 7 dias de avaliação com documentos só em pré-visualização (402 `exportacao_requer_subscricao`); pagar um módulo não activa o outro.

Ficheiros: `packages/core/src/licensing.ts`, `packages/core/src/modeling-policy.ts`, `apps/api/src/services/{licence,modules,billing,document-access}.ts`, `apps/api/src/plugins/tenant.ts`, `apps/web/components/document-export.tsx`, `apps/web/modeling/adapter.js`.

## 5. Onde ler primeiro

| Área | Onde |
| --- | --- |
| Motor RH, licenças, datas, dinheiro | `packages/core/src/` (`payroll.ts`, `licensing.ts`, `modules.ts`, `money.ts`, `packs/ao-2026.ts`) |
| Motor financeiro (Integra) | `packages/core/src/modeling/` (engine, types, templates, currency, analysis, historical, reports) |
| API, sessão, empresa | `apps/api/src/app.ts`, `plugins/tenant.ts`, `routes/auth.ts`, `services/licence.ts`, `services/modules.ts` |
| API Integra | `routes/modeling.ts`, `modeling-history.ts`, `modeling-currency.ts`; serviços `modeling-{calculation,exchange,policy,versions,access}.ts` |
| Cobrança | `routes/billing.ts`, `services/billing.ts`, `services/payments.ts` |
| Esquema e migrações | `packages/db/src/schema.ts`, `packages/db/migrations/` (+ `meta/_journal.json`) |
| Interface RH | `apps/web/app/(app)/`, `components/`, `lib/navigation.ts`, `components/app-shell.tsx` |
| Interface Integra | `apps/web/modeling/` (`prototype.html`, `adapter.js`, `store.ts`, `mobile.ts`, `space.css`); montagem em `app/modelagem/route.ts` e `lib/modeling/page.ts` |
| Importação de documentos | `packages/core/src/document-import.ts`, `apps/web/lib/document-import.ts`, `apps/web/modeling/pdf-import.ts` |
| Publicação | `.github/workflows/{ci,backup,admin-reset-2fa}.yml`, `scripts/{cf-prepare,cf-ratelimit,verify-public-site,build-modeling-ui}.mjs`, `apps/e2e/` |

Tabelas do Integra: `financial_models` (rascunho/revisão/arquivo), `modeling_members` (permissão geral e âmbito `all`/`selected`), `modeling_project_access`, `financial_personnel_imports` (snapshot agregado), `financial_historical_inputs`, `financial_model_versions` (imutáveis).

Ler `apps/web/AGENTS.md` antes de trabalho Next (versão com alterações incompatíveis; documentação em `apps/web/node_modules/next/dist/docs/`).

Documentos de outros ERP: PDF com texto, Word (.docx) e CSV/TXT. `.doc` antigo exige conversão; PDF digitalizado depende de OCR, sem garantia. A moeda muda valores e mapas, não só o símbolo (`docs/MODELAGEM-MOEDA.md`).

## 6. Contas

- **Administrador da plataforma:** `pascoalfredy@gmail.com` (variável `KIANDA_PLATFORM_ADMINS`), na empresa interna «Kianda RH — Plataforma» (NIF interno `PLATAFORMA`, excluída da lista de clientes). Palavra-passe só do dono. 2FA desactivada a 02/11 (o dono não tinha a app); recomenda-se reactivar com uma app autenticadora.
- **Demonstração** (empresa «Kwanza Logística»): `admin@`, `edson@`, `joana@kwanzalog.co.ao`, palavra-passe = secret `KIANDA_SEED_OWNER_PASSWORD` (local: `Kianda2026demo`). Com `KIANDA_SEED_DEMO=false` deixam de ser recriadas/sincronizadas nas publicações, mas continuam na base.

## 7. Stack e estrutura (monorepo pnpm)

| Pasta | O quê |
| --- | --- |
| `packages/core` | Motor puro TypeScript (sem I/O): salários, IRT, INSS, férias, assiduidade, PGC, balancete, conciliação, despesas, cessação, documentos, talento, licenças, TOTP, sectores (`sectors.ts`: regimes, subsídios, conformidade). **Valores monetários em cêntimos inteiros** (`kz(1000)` = 100000). Regras legais por ano em `src/packs/ao-2026.ts` (com lista `toValidate`). |
| `packages/db` | Drizzle 0.45 + pg. `src/schema.ts`, migrações SQL em `migrations/` (0000–0037), `scripts/seed.ts` (empresa demo), `scripts/migrate.ts`, `scripts/platform-admins.ts`. |
| `apps/api` | Hono 4 (corre em Node local e em Cloudflare Workers). Rotas em `src/routes/*.ts`, serviços em `src/services/`. Zod 4 para validação. Testes de API em `test/api.test.ts` (Vitest, base Postgres real). |
| `apps/e2e` | Testes no navegador (Playwright 1.63): área pública, RH, Integra e telemóvel. Job «Navegador (E2E)» obrigatório para publicar. |
| `apps/web` | Next 16 + React 19 (App Router) via OpenNext Cloudflare. Páginas autenticadas em `app/(app)/`; públicas: `login`, `registo`, `termos`, `acesso/[token]`, `carreiras/[company]`, `verificar/[code]`. |

Versões: TypeScript 5.9.3, Vitest 4.0.5, Hono 4.13, Zod 4.6, Next 16.4, React 19.3, OpenNext 1.20.

## 8. Arquitectura e convenções

- **Multi-empresa (tenant):** a empresa vem SEMPRE do JWT de sessão (`requireCompany` em `apps/api/src/plugins/tenant.ts`); as consultas filtram por `companyId` **e** a base de dados impõe-no: `requireCompany` corre o pedido em `withTenant` (`@kianda/db`) — transacção com `SET LOCAL ROLE kianda_app` + `app.company_id` (RLS, migração 0019). Um erro no pedido desfaz a transacção. `/v1/platform/*` corre sem RLS (só administradores). **Regras para tabelas novas:** se tem `company_id`, a migração tem de incluir `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY empresa … USING (company_id = kianda_tenant()) WITH CHECK (…)`, e a tabela entra em `COMPANY_TABLES_PURGE_ORDER` (`services/privacy.ts`); tabelas-filhas sem `company_id` usam `coluna IN (SELECT id FROM tabela_mãe)`. Os testes de guarda da entrega 18 falham se isto for esquecido. Numeração global entre empresas tem de passar por função `SECURITY DEFINER` (ex.: `kianda_next_payment_number`).
- **Licenças por módulo:** cada rota pertence a um módulo (`moduleForPath` no core: RH, Modelagem ou comum). `requireCompany` verifica a licença desse módulo: sem licença/adesão → 403; em consulta → escritas bloqueadas (402); exportação de documentos fora de `active`/`past_due` → 402 `exportacao_requer_subscricao`. `/v1/billing`, `/v1/auth/`, `/v1/platform` ficam sempre disponíveis. Lógica em `services/licence.ts`, `services/modules.ts`, `services/document-access.ts` e no core (`licensing.ts`, `modules.ts`). O Integra exige ainda um participante activo em `modeling_members` e, se o âmbito for `selected`, a atribuição do projecto (`services/modeling-access.ts`; projecto não atribuído → 404).
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

## 9. Produção e publicação (pormenor)

- **Cloudflare:** Worker `kianda-web` (único público, domínio `kianda.yelaperformance.com`) e Worker `kianda-api` (sem endereço público, só via service binding `API`). Conta `9d30c22314c1728b12b9fc0946c3356a`.
- **Base de dados:** Neon Postgres (Frankfurt) via **Hyperdrive** (id `139b36ef3c0e47f3b348311b60693147`, cache desligada).
- **CI** (`.github/workflows/ci.yml`): jobs «Verificar e testar» (tipos, testes com Postgres, build OpenNext) e «Navegador (E2E)» em paralelo; só depois, em `main` com `vars.KIANDA_DEPLOY == 'true'`, «Publicar no Cloudflare»: valida secrets (uma linha, sem espaços) → migra → administradores da plataforma → seed (se `KIANDA_SEED_DEMO == 'true'`) → regra de limite de tentativas (`scripts/cf-ratelimit.mjs`, só avisa sem permissão) → `scripts/cf-prepare.mjs` → deploy API + `wrangler secret bulk` → build/deploy web → `/api/health` e smoke público (`scripts/verify-public-site.mjs`); o login de demonstração só é verificado com `KIANDA_SEED_DEMO=true`.
- **Outros workflows:** «Cópia de segurança» (`backup.yml`, diário às 02:17, cifra + teste de restauro) e «Administração — repor verificação em dois passos» (`admin-reset-2fa.yml`, manual, input `email`, só administradores da plataforma).
- **Secrets GitHub:** `CLOUDFLARE_API_TOKEN` (token `kianda-rh-deploy`: publicação + «Zone WAF Rules · Edit» para a regra de limite), `CLOUDFLARE_ACCOUNT_ID`, `KIANDA_HYPERDRIVE_ID`, `KIANDA_DATABASE_URL`, `KIANDA_DATABASE_CA_CERT` (opcional), `KIANDA_JWT_SECRET`, `KIANDA_SEED_OWNER_PASSWORD`, `KIANDA_BACKUP_PASSPHRASE`.
- **Variáveis GitHub:** `KIANDA_DEPLOY=true`, `KIANDA_SEED_DEMO=false` (desde 01/11/2026), `KIANDA_HOSTNAME`, `KIANDA_MODELING_OWNER_USER_ID` (opcional, Excel da Modelagem), `KIANDA_PLATFORM_ADMINS=pascoalfredy@gmail.com`; integrações (opcionais): `KIANDA_PROXYPAY_ENV`, `KIANDA_PROXYPAY_ENTITY`, `KIANDA_MAIL_FROM`, `KIANDA_VENDUS_MODE`.
- **Secrets opcionais (integrações):** `KIANDA_PROXYPAY_API_KEY`, `KIANDA_RESEND_API_KEY`, `KIANDA_VENDUS_API_KEY`.
- Nas sessões de agente a área de **secrets e variables do GitHub está bloqueada (403)**: alterá-las é tarefa do dono. Logs e anotações dos jobs lêem-se com `gh api repos/…/actions/jobs/<id>/logs` e `…/check-runs/<id>/annotations`; `gh workflow run` funciona (publicar, cópia, procedimentos manuais).

## 10. Desenvolvimento local

```bash
pnpm install
pnpm db:up                   # PostgreSQL em Docker (ou um Postgres local); se os testes da API aparecerem "skipped", a base não está acessível
export DATABASE_URL=postgresql://kianda:kianda@localhost:5432/kianda
export API_JWT_SECRET="segredo-de-desenvolvimento-local-com-mais-de-32"
pnpm db:migrate && SEED_OWNER_PASSWORD=Kianda2026demo pnpm db:seed
pnpm --filter @kianda/core build && pnpm --filter @kianda/db build   # a API consome os dist
pnpm -r typecheck && pnpm -r test   # ver contagens actuais na secção 3
(cd apps/api && npx tsx src/server.ts)                               # :4000
(cd apps/web && npx next build && API_URL=http://localhost:4000 npx next start -p 3000)
```

- **Testes no navegador (`apps/e2e`, Playwright 1.63):** `pnpm --filter @kianda/web build` e depois `DATABASE_URL=… pnpm --filter @kianda/e2e e2e` (arranca a API e a web sozinho; localmente reutiliza servidores já abertos em 3000/4000). Cada teste regista a sua própria empresa pela API; SQL directo só para cenários sem ecrã (licença paga, orçamento aprovado). Projectos `computador` (1440×900) e `telemovel` (Pixel 7, ficheiros `*mobile.spec.ts`). Falham com erros de JavaScript na consola (excepto fontes externas). No CI, falhas deixam o relatório e o trace como artefacto `playwright-report`. Ao mudar textos ou estrutura de um ecrã coberto, actualizar o teste.
- Matar servidores: `fuser -k 3000/tcp 4000/tcp` (não usar `pkill -f "next start"`: mata a própria shell).
- **Migrações novas:** `cd packages/db && npx drizzle-kit generate --name <nome>`. Se o drizzle-kit pedir confirmação interactiva (tabela que sai e outra que entra), dividir em duas migrações.
- **Verificações exploratórias no navegador** (fora da bateria `apps/e2e`): Playwright global (`NODE_PATH=$(npm root -g) node script.js`).
- Rede da sessão do agente: só registos de pacotes/GitHub; `kianda.yelaperformance.com` não é alcançável a partir do agente (validar produção pelo CI).

## 11. Armadilhas já resolvidas (não repetir)

- Fastify gera código com `new Function` → proibido nos Workers → por isso Hono.
- Instalar `@cloudflare/workers-types` duplicou o drizzle → operadores re-exportados de `@kianda/db`.
- `proxy.ts` do Next corre em Node e é experimental em Cloudflare → protecção no layout.
- Limite de tentativas partilhado atrás do binding → conta por IP real (`x-forwarded-for` escrito pelo web a partir de `cf-connecting-ip`) e só falhas.
- Estado React em sequência rápida (avaliações): usar actualizações funcionais `setX((s) => …)`.
- Referências de lançamento únicas: depois de um estorno, novo pagamento leva sufixo `-2`, `-3`.
- Testes que criam dados partilhados (ex.: parâmetros da plataforma) devem limpar no `beforeAll`.
- Testes com datas fixas comparam com o relógio real: quando o resultado depende do dia (ex.: alterações salariais «futuras»), calcular com `luandaDate(new Date())`.
- Drizzle dentro de `sql\`…\`` escreve a coluna sem tabela (`"id"`): numa subconsulta resolve para a tabela interna. Qualificar à mão (`personnel_budgets.id`).
- `.form .f` usa `display:flex`, que vence o atributo `hidden`: esconder com `style.display`.
- Cache antiga do Next (`.next`) dá erros falsos de tipos/«invalid digit»: apagar `.next` antes de concluir que é defeito.
- Integra: não editar `apps/web/public/modeling-runtime.js` nem `lib/modeling/generated.ts`; alterar `modeling/adapter.js`, `space.css`, `store.ts` ou as substituições em `scripts/build-modeling-ui.mjs` e correr `pnpm --filter @kianda/web modeling:generate` (o CI verifica com `--check`).
- Secrets colados com espaço/linha a mais: a publicação pára na validação antes de tocar na produção. Voltar a colar só o valor.

## 12. Regra de cálculo manual (27/10/2026)
Decisão do contabilista: onde a LGT não fecha a regra, o motor **não calcula** — conta os dias, avisa no processamento ("CÁLCULO MANUAL") e o valor é lançado nas variáveis:
- Licença de maternidade (suspensão do salário) → variável "Desconto na remuneração" (código `CORTE`, abono negativo que reduz INSS/IRT).
- Feriado trabalhado (art. 200.º, n.º 2) → "Outro abono".
- Vésperas de 24 e 31 de Dezembro (art. 199.º) → aviso em Dezembro; horas devidas lançadas à mão.
- Subsídios em ano com suspensão (art. 238.º, n.º 3) → aviso; ajuste manual.
O core mantém `suspendedDays`, `holidayWorkDays` e `familyEveMinutes` (testados), mas a API não os usa.

## 13. Início sugerido para a próxima sessão

1. Ler este documento e a última mensagem do dono.
2. Actualizar o checkout (`git fetch && git checkout main && git pull`) e ler o histórico recente; preservar alterações de terceiros.
3. Antes de mexer em cálculos, licenças ou dados: ler core, API, esquema e migrações da área.
4. Preservar preços, quotas, sectores, avaliação, exportações, isolamento e layouts aprovados.
5. Fazer o pedido concreto, testar os riscos reais e só publicar quando estiver validado. Sem novo objectivo, perguntar qual é a próxima alteração.

## 14. Referência técnica por entrega (RH)

- Processamento: IRT Grupo A 2026, INSS 3%+8%, subsídios (férias/Natal, proporcionais), horas extra (50%/75%, blocos de 15 min), faltas, variáveis, mês incompleto proporcional, recibos com hash.
- Contas PGC sugeridas (parametrizáveis): 72.2.1–72.2.4, 72.5.1, 34.3 (IRT), 34.9.1 (INSS), 36.1.2, 36.3, 36.9, 43.1, 75.2 (despesas), 72.8 (ajudas de custo e compensações por cessação), 63 (compensação por falta de aviso do trabalhador).
- Acessos: convites por ligação (WhatsApp/SMS/email), PIN com código da empresa, 2FA TOTP, bloqueio após 5 falhas.
- Sectores (entrega 16): tabelas `work_schedules`, `allowance_types`, `employee_allowances`; `employees.scheduleId/scheduleAnchor`. Rotas em `apps/api/src/routes/sector.ts` (`/v1/sector`, `/v1/schedules`, `/v1/allowance-types`, `/v1/work-regime/:employeeId`, `/v1/employee-allowances/:id`, `/v1/compliance`). O processamento (`services/payroll.ts`) junta os subsídios como `otherEarnings` com o código do catálogo (vão para a conta de subsídios no fecho). Páginas `/sector`, `/conformidade` e separador "Horário e subsídios" na ficha.
- Integrações (entrega 17): `apps/api/src/services/integrations.ts` (clientes ProxyPay, Resend, Vendus — só activos com o secret), `services/billing.ts` (referência, confirmação, factura, recibo, `applyGatewayPayment` idempotente por `gateway_events`, `syncGatewayPayments`), `services/mail.ts` (modelo HTML, registo em `outbound_emails`, `dedupeKey`), `services/jobs.ts` (avisos de licença). Webhook público `POST /v1/public/gateway/proxypay` (passa pelo proxy `/api` da web, que reencaminha `x-signature`). Worker com `scheduled()` e crons em `apps/api/wrangler.jsonc`. Nos testes, os fornecedores são simulados substituindo `globalThis.fetch` (ver bloco da entrega 17); para testar no browser use `PROXYPAY_BASE_URL`/`RESEND_BASE_URL`/`VENDUS_BASE_URL` a apontar para um servidor falso. Configuração em `docs/DEPLOY.md` (secção Integrações).

- Ficheiros (entrega 20): tabelas `files` (metadados) e `file_blobs` (conteúdo quando não há R2), ambas com RLS. `services/storage.ts` (`setObjectStore`, `storeFile`, `readFileData`, `removeFiles`; o Worker liga o R2 pelo binding `FILES`), rotas em `routes/files.ts` (`GET/POST /v1/files?entity=&entityId=`, `GET/DELETE /v1/files/:id`; o envio é o corpo em bruto, sem multipart). Entidades: `employee`, `employee_document`, `absence`, `expense_claim` — regras de acesso em `fileAccess`. Componente web `components/attachments.tsx`. O CI cria o bucket `kianda-files` e só então junta o binding (`KIANDA_R2=1` → `scripts/cf-prepare.mjs`).
- Recuperação por email (entrega 20): `POST /v1/auth/forgot` cria ligações `access_links.kind = 'self_reset'` (1 h); a aceitação troca só a palavra-passe e mantém a 2FA (`completeLogin(..., secondFactorDone=false)`). Página `/recuperar`.

- Formatos oficiais (entrega 21): `packages/core/src/official.ts` (`AGT_MAP_COLUMNS`, `agtMapRow`, `agtProvince`, `ANGOLA_BANKS`, `bankFromIban`, `bankAmount`), `apps/api/src/lib/xlsx.ts` (xlsx mínimo, ZIP stored), rotas `GET /v1/payroll-runs/:id/maps/agt?format=xlsx|csv|json` e `bank-file?profile=generic|bfa|bai`. Campos novos: `companies.province/municipality/bankFileProfile`, `employees.municipality`. Fontes: guia rápido da AGT (upload Excel/CSV/XML, todos os trabalhadores), documentação Cegid/Primavera das 31 colunas e siglas, guia do BFA (transferências por lotes) e página do BAI (pagamento em massa). Alinhado com os templates reais entregues pelo dono (AGT A2.1 e simplificado, Folha de Remuneração do INSS Virtual); lista de municípios em `packages/core/src/agt-municipalities.ts` (gerada da folha Auxiliar do template). Banco: NOME, NIB, VALOR por omissão.

- Relatórios (entrega 22): `packages/core/src/reports.ts` (`peopleReport`, `costGroup`, `workingDaysInMonth`, `splitAbsenceByMonth`), rota `GET /v1/reports/people?from&to&format=json|xlsx` em `apps/api/src/routes/reports.ts`, página `/relatorios` (gráfico SVG próprio, sem bibliotecas). Departamento = o actual da ficha (não há histórico de departamentos).

- Orçamento (entrega 23): tabelas `personnel_budgets` (ano, estado, hipóteses jsonb) e `personnel_budget_lines` (departamento × mês: efectivo, ilíquido, custo), com RLS; `packages/core/src/budget.ts` (`budgetProjection`, `budgetVsActual`); rotas em `apps/api/src/routes/budget.ts` (`GET /v1/budgets?year`, `POST /v1/budgets/simulate`, `POST /v1/budgets`, `/:id/regenerate`, `PUT /:id/lines`, `/:id/approve` e `/:id/reopen` só proprietário, `DELETE`, `/:id/export`); página `/orcamento`.

- App móvel (entrega 24): `app/manifest.ts`, `public/sw.js` (+ `public/_headers` para não guardar o sw em cache), `public/icons/*`, `components/pwa.tsx` (registo do SW, barra de sem rede, convite a instalar, `clearOfflineData` no logout), `lib/offline-punch.ts` (fila do ponto sem rede). API: `POST /v1/attendance/clock` aceita `at` + `clientRef` (origem `offline`, `offlineOut`), colunas `attendance_entries.client_ref/offline_out`.
