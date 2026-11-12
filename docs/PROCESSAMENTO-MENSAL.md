# Processamento habitual e alterações mensais

Preparar processamento mostra a remuneração em vigor dos colaboradores elegíveis, em páginas de 50. Processar em lote permite seleccionar um grupo. O cálculo usa os valores permanentes da ficha, os subsídios recorrentes e os registos de assiduidade aprovados.

Alterações permanentes fazem-se na ficha salarial com a respectiva data de efeito. Prémios e descontos pontuais pertencem ao mês em que são registados.

O formulário individual de alterações começa recolhido. Abrir um lote vazio, seleccionar pessoas, pesquisar ou mudar incidências não condiciona o cálculo. Uma alteração real por guardar pode ser guardada, descartada ou cancelada. Durante uma gravação aguarda-se a resposta do servidor.

O separador Variáveis permite editar lançamentos mensais antes do fecho: tipo, descrição, valor, incidências e nota. A edição verifica a versão apresentada e fica auditada. Recalcular actualiza o rascunho. Prestações de adiantamentos e valores de cessação continuam geridos na origem; meses fechados mantêm-se protegidos.

Referência: [Cegid Primavera — Processamentos individuais e em lote](https://help.ila.cegid.com/primavera/docs/1600786551). A implementação usa as regras e permissões existentes no Kianda.

## Maternidade e preparação para o IRPS

Em **Processamento → Variáveis → Apurar subsídio de maternidade**, o simulador estima
o subsídio legal do regime geral de três meses do Decreto Presidencial n.º 95/26 e
mostra separadamente o eventual complemento patronal. A empresa introduz as últimas
12 remunerações regulares declaradas e os meses com contribuições nos últimos 36.
O objectivo patronal é opcional e corresponde ao total do período, por exemplo três
salários-base sem os abonos que a empresa decidiu excluir. O complemento cobre a
diferença positiva. A folha e o pedido de reembolso seguem os respectivos procedimentos
de validação e lançamento.

Para a mudança do IRT para o IRPS na folha:

1. Confirmar a data de aplicação, o facto relevante (competência, pagamento ou outro
   critério definido no diploma), as regras transitórias, a base e a tabela de retenção
   do trabalho dependente no Diário da República e nas instruções da AGT.
2. Versionar a regra de retenção por vigência e ligar o cálculo à regra gravada na
   folha. Antes da activação, resolver o comportamento de recurso ao pacote do ano
   anterior, para impedir que a tabela IRT seja aplicada a um pagamento sujeito a IRPS.
3. Actualizar recibo, mapa de retenções, exportações e lançamento PGC em conjunto.
   Testar os limites dos escalões e os pagamentos que atravessam a transição, incluindo
   retroactivos, acertos e subsídios. Preservar o regime e os valores das folhas fechadas.
4. Publicar o regime após validação com as tabelas e os formatos oficiais aplicáveis.

## Valor diário e valor-hora

- **Mês incompleto e aviso prévio contado em dias de calendário**: o Kianda aplica
  salário-base ÷ 30, como convenção operacional do processamento e da cessação.
- **Férias vencidas e proporcionais na cessação**: o Kianda usa a proporção sobre
  22 dias úteis. Os artigos 204.º, 212.º e 213.º da LGT distinguem a duração, os
  dias devidos e a remuneração de férias. Os complementos técnicos e de
  disponibilidade aplicáveis devem ser conferidos no fecho de contas.
- **Faltas, atrasos, licenças não remuneradas e acréscimos horários**: o valor-hora
  segue o artigo 237.º, n.º 7: base × 12 ÷ (52 × horário normal semanal).
  Usam-se as horas do regime do trabalhador ou, na sua ausência, do horário normal
  da empresa. Nos regimes cíclicos usa-se a média semanal do ciclo cadastrado.
  A escala publicada determina as horas de ausência nos dias abrangidos.
- **Feriado trabalhado**: o processamento mantém o aviso de revisão manual do
  acréscimo de um dia de salário normal e do descanso compensatório, conforme o
  artigo 200.º, atendendo às excepções do regime aplicável.
