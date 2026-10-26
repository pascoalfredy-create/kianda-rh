# Arquitectura

## Princípios

1. **Motor de cálculo puro.** `@kianda/core` não acede a base de dados nem à rede. Recebe dados, devolve resultados. É testado de forma isolada e reutilizado pela API e pela web.
2. **Regras legais como dados versionados.** IRT, INSS, salário mínimo, feriados, prazos e parâmetros da LGT vivem num `CountryPack` por ano. O motor é genérico.
3. **Dinheiro em inteiros.** Cêntimos de kwanza (`number` inteiro no core; `bigint` no PostgreSQL). Percentagens em pontos base.
4. **Multi-empresa desde o início.** `company_id` em todas as tabelas de negócio; a API resolve a empresa em cada pedido.
5. **Auditoria só de escrita.** Criações, processamentos e fechos ficam em `audit_logs` com valores antes e depois.
6. **Processamentos fechados são imutáveis.** Fechar um mês gera o lançamento PGC e bloqueia o recálculo.

## Camadas

```
apps/web (Next.js) ──HTTP──► apps/api (Fastify) ──► packages/db (Drizzle) ──► PostgreSQL
        │                           │
        └──────────► packages/core ◄┘   (mesmo motor nos dois lados)
```

## Módulos do motor (`packages/core/src`)

| Ficheiro | Responsabilidade |
| --- | --- |
| `money.ts` | Cêntimos, taxas em pontos base, formatação em Kz |
| `packs/` | Pacotes de regras por país e ano (`AO-2026`); registo e validação de novos pacotes |
| `payroll.ts` | Processamento mensal, IRT Grupo A, horas extra, subsídios, faltas, simulador líquido → bruto, alertas de SMN |
| `calendar.ts` | Dias úteis com feriados, prazos de INSS e IRT, alertas de contrato e período experimental |
| `validation.ts` | BI angolano, IBAN (ISO 13616, mod 97), NIF de empresa |
| `termination.ts` | Fecho de contas na cessação (a compensação legal por motivo fica fora do motor até validação jurídica) |
| `pgc.ts` | Lançamentos PGC do processamento e dos pagamentos, com verificação débito = crédito |
| `reconciliation.ts` | Correspondência entre movimentos bancários e obrigações (salários, IRT, INSS, reembolsos) |

## Decisões

- **Drizzle ORM** em vez de Prisma: JavaScript puro, sem binários de motor, migrações SQL legíveis e o mesmo ORM do Enterprise Performance.
- **Fastify + Zod** na API: validação declarativa e erros devolvidos em português com o campo afectado.
- **Subsídio de férias fora da base do INSS** por defeito (DP 227/18), configurável no pacote — a validar com consultor.
