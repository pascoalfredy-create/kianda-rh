# Kianda RH + Kianda Integra

Uma conta, um repositório e uma base de dados para dois módulos com licenças próprias, para empresas angolanas:

- **Kianda RH** — gestão de pessoas, processamento salarial (IRT, INSS, LGT) e finanças de pessoal com **lançamentos contabilísticos segundo o PGC Angola** (Decreto n.º 82/2001; classe 6 = proveitos, classe 7 = custos).
- **Kianda Integra · Modelagem Financeira** — projectos de investimento e avaliação de empresas nos 8 sectores, com demonstrações projectadas, DCF, crédito, cenários, relatórios em PDF, versões aprovadas e análise de balancetes.

**Para continuar o trabalho, comece por [docs/HANDOFF.md](docs/HANDOFF.md).** Preços e regras comerciais: [docs/MODULOS-LICENCAS.md](docs/MODULOS-LICENCAS.md) (verificados contra o código por teste).

## Estrutura

```
kianda-rh/
├── apps/
│   ├── api/        API REST (Hono + Zod) — Node em local, Cloudflare Workers em produção
│   ├── web/        Aplicação web (Next.js 16 + React 19); Integra em apps/web/modeling
│   └── e2e/        Testes no navegador (Playwright), obrigatórios para publicar
├── packages/
│   ├── core/       Motor puro: payroll Angola, calendário, cessação, PGC, conciliação, licenças e motor financeiro do Integra
│   └── db/         Esquema PostgreSQL e migrações (Drizzle ORM)
└── docs/           Passagem (HANDOFF), comercial, Integra, publicação, arquitectura e roadmap
```

O `packages/core` não faz I/O: as mesmas funções correm na API, na web (simulador) e nos testes, por isso os números são idênticos em todo o lado.

## Requisitos

- Node.js 22 ou superior e pnpm 10 (`corepack enable`)
- PostgreSQL 16 ou superior (ou Docker)

## Arranque local

```bash
pnpm install
cp .env.example .env                 # ajuste DATABASE_URL se necessário
pnpm db:up                           # PostgreSQL em Docker (opcional)
pnpm --filter @kianda/core build
pnpm db:migrate                      # aplica packages/db/migrations
pnpm db:seed                         # empresa de demonstração e utilizador proprietário
pnpm dev                             # API em :4000 e web em :3000
```

Entre em http://localhost:3000 com `admin@kwanzalog.co.ao` e a palavra-passe de `SEED_OWNER_PASSWORD` (por omissão `Kianda2026demo`). Novas empresas registam-se via `POST /v1/auth/register`.

### Sessões e perfis

- A API emite um JWT num cookie `kianda_session` (httpOnly, SameSite=Lax, 8 h). A empresa vem do token assinado — nunca de um cabeçalho do cliente.
- O browser só fala com o Next; `/api/*` é reencaminhado para a API, por isso o cookie é sempre do mesmo domínio.
- Perfis: `owner`, `hr_admin`, `payroll`, `finance`, `manager`, `employee`. Segregação de funções: quem prepara o processamento não o pode fechar (excepto o proprietário).

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm test` | Testes de todos os pacotes (os testes da API com base de dados correm quando `DATABASE_URL` está definida) |
| `pnpm --filter @kianda/e2e e2e` | Testes no navegador (depois de `pnpm --filter @kianda/web build`) |
| `pnpm typecheck` | Verificação de tipos |
| `pnpm build` | Compila core, db, api e web |
| `pnpm --filter @kianda/db generate` | Gera uma nova migração a partir de `packages/db/src/schema.ts` |

## Regras de negócio

- Montantes em **cêntimos de kwanza**, inteiros; sem vírgula flutuante sobre dinheiro.
- Regras legais em **pacotes anuais versionados** (`packages/core/src/packs`). O pacote em vigor é `AO-2026.2` (IRT Lei 14/25, INSS 3%/8%, SMN 100 000 Kz, LGT Lei 12/23, feriados 2026).
- Um ano sem pacote publicado é **recusado**, nunca processado com as regras do ano anterior. O pacote AO-2027 tem de ser registado quando o OGE 2027 for publicado.
- Cada pacote lista os pontos que precisam de validação jurídica (`toValidate`).
- Todas as tabelas de negócio têm `company_id` (multi-empresa) e as alterações ficam no registo de auditoria.

## Estado

Em produção, com RH e Integra completos, licenças por módulo, avaliação de 7 dias, cópias de segurança diárias testadas e testes no navegador antes de cada publicação. Estado detalhado, pendentes e regras do dono em [docs/HANDOFF.md](docs/HANDOFF.md); histórico das entregas em [docs/ROADMAP.md](docs/ROADMAP.md).

## Publicação

**Produção:** https://kianda.yelaperformance.com

Cada push para `main` testa e publica no Cloudflare (Workers + Hyperdrive + Neon PostgreSQL). Configuração única em [docs/DEPLOY.md](docs/DEPLOY.md).
