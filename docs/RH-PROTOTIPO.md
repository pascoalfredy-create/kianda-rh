# Recuperação da apresentação do protótipo RH

O RH tinha perdido os seis grupos do menu original, a navegação completa no telemóvel e várias composições dos ecrãs aprovados. A referência é o HTML «Kianda RH — Gestão de Pessoas para Angola», SHA-256 `f61e6678e44b8e656272a76b5aa2b78850b3fc46b68be9b109b3bcc15c944e3e`.

O menu usa uma única definição para computador e telemóvel, condicionada pelas permissões e módulos da sessão. O botão móvel abre essa mesma navegação, com Escape, contenção do foco e fecho ao navegar. A área Plataforma mantém os módulos/licenças separados das Finanças de pessoal do RH. O selector de perfis de demonstração não é transportado para produção.

A barra superior recupera pesquisa (incluindo NIF), ponto e pendências. A lista de colaboradores recupera filtros e colunas; abre a ficha existente num diálogo lateral e preserva os endereços completos. A criação também continua disponível por endereço próprio. O calendário é acrescentado às vistas actuais de férias; o mapa por colaborador continua disponível. Documentos recupera a galeria, sem perder emissão, versões e arquivo. Recrutamento recupera o quadro geral e permite mover fases pela API existente, com alternativa ao arrastar para toque/teclado. Contratar continua a exigir a admissão real.

O painel RH e os relatórios recuperam efectivo, massa salarial, retenções, aniversários, género, antiguidade, mediana salarial e gráficos por departamento. A origem dos valores salariais é identificada: processamento fechado, rascunho ou estimativa do quadro actual. A chefia não recebe os valores financeiros do novo resumo. Os relatórios de processamentos continuam a usar somente meses fechados.

## Mapas que faltavam

- `/tesouraria`: seis meses por datas de vencimento, saldo inicial e recebimentos manuais, valores pagos excluídos e atrasados incluídos no primeiro mês. O GET não cria ou recalcula processamentos. Os pressupostos ficam em `personnel_cash_plans`, por empresa e mês inicial, com RLS, auditoria e controlo de revisão contra gravações concorrentes. Finanças/proprietário editam; processamento consulta.
- `/analitica`: matriz de custo por centro de custo e mês fechado, totais reconciliáveis e gráfico estimado por local do quadro actual. O centro corresponde ao departamento actual da ficha, tal como no relatório existente.

As projecções de Tesouraria usam contratos, remunerações e subsídios recorrentes conhecidos. Não incluem horas extra, faltas, prémios ou acréscimos variáveis de horário. O mês de férias segue a configuração da empresa, usando Dezembro quando não há mês fixo. Não incluem admissões hipotéticas do orçamento. Anos sem pacote publicado usam a última regra de referência disponível, com aviso explícito; o processamento real continua bloqueado para esses anos. O saldo disponível introduzido deve representar a caixa à data da previsão; os recebimentos são os que ainda se esperam receber.

## Verificação

Há testes de cálculo dos saldos e datas, obrigações pagas, atrasados, mudança de ano, montantes seguros, acesso ao menu, destaque de rota e isolamento entre módulos. Os testes de integração PostgreSQL verificam o RLS, os perfis, a gravação concorrente, a ausência de escritas no GET, a exclusão de pagamentos e a reconciliação da matriz com o processamento fechado. A migração aditiva `0034_personnel_cash_plans` inclui a nova tabela na exportação/eliminação da empresa.

As alterações do RH não modificam o protótipo, os estilos ou o runtime gerado do Integra. `build-modeling-ui.mjs --check` continua a verificar a correspondência exacta dos artefactos do módulo financeiro.
