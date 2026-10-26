# Roadmap

Ordem proposta a partir do protótipo HTML do Kianda RH (funcionalidades já validadas visualmente).

| Ordem | Entrega | Inclui |
| --- | --- | --- |
| 1 ✅ | Autenticação e perfis | Login, sessões (JWT/cookies httpOnly), perfis `owner`, `hr_admin`, `payroll`, `finance`, `manager`, `employee`; substitui o cabeçalho `x-company-id`. **Concluída**: registo, login, logout, gestão de utilizadores, protecção de rotas no Next (`proxy.ts`), limitação de tentativas |
| 2 | Ficha do colaborador completa | Edição, documentos de identificação, organograma, histórico de contratos e salários |
| 3 | Ausências e férias | Aprovação, saldos de 22 dias úteis, calendário com feriados, mapa de férias |
| 4 | Assiduidade | Registo de entrada/saída web e móvel, horas extra para o processamento |
| 5 | Processamento completo | Variáveis do mês (horas extra, faltas, prémios, adiantamentos), subsídios de férias e Natal, recibos com hash |
| 6 | Obrigações e pagamentos | Mapas de IRT e INSS, prazos, ficheiro de transferência bancária, marcação de pagamentos |
| 7 | Finanças de pessoal | Diário PGC, balancete do período, plano de contas parametrizável, exportação CSV para ERP |
| 8 | Conciliação bancária | Importação de extractos, correspondência automática, controlo de pagamentos sem comprovativo |
| 9 | Despesas e ajudas de custo | Pedido, aprovação, reembolso e nota de despesas |
| 10 | Cessação de contrato | Fluxo por motivo, fecho de contas, documentos de cessação |
| 11 | Documentos | Contratos, declarações, certificado de trabalho, comunicações — modelos versionados com o pacote do ano |
| 12 | Recrutamento e desempenho | Pipeline de candidatos, ciclos de avaliação |
| 13 | Portal do colaborador | Recibos, férias, despesas e declarações em autosserviço |

## Antes de produção

- [ ] Registar o pacote **AO-2027** quando o OGE 2027 for publicado (o processamento de Janeiro de 2027 é recusado até lá).
- [ ] Validação jurídica dos pontos listados em `AO_2026.toValidate`.
- [ ] Recuperação de palavra-passe por email e 2FA para `owner`/`finance`.
- [ ] Testes de interface (Playwright) e cobertura mínima no core.
- [ ] Política de cópias de segurança e retenção de dados.
