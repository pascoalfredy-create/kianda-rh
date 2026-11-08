# Análise histórica do Integra — retirada

Desde 03/11/2026 (PR #52) o Integra **não recebe balancetes nem outra informação externa**, por decisão do dono do produto.

- A vista «Análise de demonstrações» e o relatório `analise` usam apenas as demonstrações projectadas do próprio projecto, ano a ano no horizonte (`packages/core/src/modeling/project-analysis.ts`).
- As rotas `/v1/modeling/models/:id/history*`, a importação de balancetes (PDF, Word, CSV) e o «criar modelo a partir de balancetes» foram retiradas.
- A análise de empresas a partir de dados reais (balancetes, real mensal, controlo orçamental) faz-se no **Valora**.

## O que ficou, e porquê

- `packages/core/src/modeling/historical*.ts`: leitor e rácios do PGC, ainda usados pela análise do projecto (definições de rácios) e disponíveis para importadores do Valora. Têm testes próprios.
- Tabela `financial_historical_inputs`: conserva os dados já guardados antes da retirada (sem rotas de leitura ou escrita). As versões aprovadas antigas que incluíam o relatório histórico continuam imutáveis.
- `apps/web/modeling/pdf-import.ts`: leitor de PDF partilhado com a conciliação bancária e as importações do RH (o nome é histórico).
