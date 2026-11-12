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
