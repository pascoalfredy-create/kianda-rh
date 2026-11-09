# Validação das regras laborais contra a Lei Geral do Trabalho (Lei n.º 12/23)

Feita a 09/11/2026, a pedido do dono, só com os artigos da LGT que o código cita.
Método: cada referência «art. N.º» do núcleo, da API e da web foi confrontada com o texto oficial da Lei n.º 12/23 (Diário da República n.º 245, de 27/12/2023). Foram 40 artigos e cerca de 110 referências.

Legenda: **Conforme**, a regra do código diz o que o artigo diz. **Corrigido**, havia diferença e foi corrigida nesta validação. **Manual**, a lei não fecha o cálculo e o motor avisa (regra do contabilista de 27/10/2026). **Fora do motor**, a regra existe na lei mas não é calculada automaticamente.

## Contratos

| Artigo | Regra no Kianda | Estado |
| --- | --- | --- |
| 15.º e 16.º | Contrato a termo só nas causas do art. 15.º. Duração máxima: 6, 12, 36 ou 60 meses conforme a causa. | Conforme |
| 17.º, n.º 3 e 4 | Aviso de não renovação de 30 dias; sem aviso, a empresa paga 30 dias. Usado na minuta e no fecho de contas. | Conforme |
| 17.º, n.º 5 | Conversão em contrato sem termo se forem ultrapassados os limites. | Conforme (alerta) |
| 18.º | Período experimental de 60 dias (até 120 ou 180 por acordo escrito); até 30 dias no contrato a termo; cessação sem aviso nem indemnização. | Conforme |

## Turnos, horário e trabalho extraordinário

| Artigo | Regra no Kianda | Estado |
| --- | --- | --- |
| 148.º | 8 h por dia e 44 h por semana; até 54 h em turnos ou horário modulado; mais de 10 h por dia só em trabalho intermitente. | Conforme (validação das escalas) |
| 161.º, n.º 1 e 3 | Turnos rotativos até 8 h, salvo quando a natureza da actividade não o permite. | Conforme (validação das escalas) |
| 161.º, n.º 2 | Intervalo de 30 minutos nos turnos rotativos. | Fora do motor (definido no tipo de turno) |
| 162.º | Adicional de 20% do salário base em turnos rotativos, que já inclui o nocturno; sem adicional em dois turnos. | Fora do motor: configurar como subsídio da empresa |
| 179.º e 182.º | Nocturno das 20h às 6h, com adicional de 20% do salário base. | Fora do motor: configurar como subsídio |
| 185.º | Limites de 2 h por dia, 40 h por mês e 200 h por ano; acima disso, só com consentimento do trabalhador e autorização da IGT. | Conforme (bloqueio na aprovação) |
| 186.º | Descanso compensatório pelo trabalho em dia de descanso. | Conforme (nota) |
| 188.º | Mais 50% até 30 h por mês e mais 75% acima. Arredondamento: menos de 15 min não conta; 15 a 44 min contam ½ h; 45 a 60 min contam 1 h. | Conforme |
| 194.º | Dia de descanso trabalhado pago com mais 75%, com mínimo de 3 h. | Conforme |
| 198.º e 199.º | Tolerância de ponto; paragem às 12h30 de 24 e 31 de Dezembro, excepto laboração contínua. | Manual (aviso em Dezembro) |
| 200.º | Feriado trabalhado: mais um dia de salário e descanso compensatório; não se aplica a turnos. | Manual (o motor conta os feriados e avisa) |

## Férias, faltas e doença

| Artigo | Regra no Kianda | Estado |
| --- | --- | --- |
| 201.º, 204.º e 205.º | 22 dias úteis; no ano de admissão, 2 dias por mês com mínimo de 6, gozo depois de 6 meses; contratos até 1 ano, 2 dias por mês. | Conforme |
| 212.º | Na cessação: férias vencidas mais as proporcionais. | Conforme |
| 213.º | Alimentação e transporte não são pagos nas férias, salvo acordo (definição da empresa). | Conforme |
| 218.º | Paternidade: 1 dia pago e 7 dias úteis não remunerados. | Conforme |
| 222.º e 223.º | Casamento, 8 dias seguidos; luto, 8 ou 3 dias úteis conforme o parentesco. | Conforme |
| 226.º, n.º 1 | Doença paga pela empresa durante **6 meses**, com direito de regresso sobre a segurança social. | **Corrigido**: antes não havia limite. Agora, depois de 6 meses seguidos de doença, a folha desconta os dias (contrato suspenso, art. 268.º, n.º 1) e avisa. |
| 226.º, n.º 2 | Num contrato a termo, o pagamento cessa no fim do contrato. | Conforme: a folha só inclui contratos em vigor |
| 226.º, n.º 3 | Assistência à família: até 8 dias úteis pagos por ano. | Fora do motor (limite guardado no pacote, sem bloqueio) |
| 230.º | Faltas injustificadas: perda de salário; infracção disciplinar acima de 3 por mês ou 12 por ano. | Conforme (aviso) |
| 31.º a 35.º, 267.º e 268.º | Maternidade de 3 meses (mais 4 semanas em parto múltiplo), licença complementar não paga, contrato suspenso. | Manual (subsídio pela segurança social) |

## Salário, descontos e subsídios

| Artigo | Regra no Kianda | Estado |
| --- | --- | --- |
| 238.º | Gratificação de férias e subsídio de Natal de pelo menos 50% do salário base; proporcionais aos meses completos. | Conforme; em ano com suspensão o ajuste é Manual |
| 245.º | Salário até ao último dia útil; créditos da cessação em 3 dias. | Conforme |
| 247.º | Recibo com o n.º de beneficiário da segurança social e todos os descontos. | Conforme |
| 248.º | Adiantamentos a pedido escrito, até 3 salários base; descontos a crédito até 25% do líquido. | Conforme |

## Cessação e termos finais

| Artigo | Regra no Kianda | Estado |
| --- | --- | --- |
| 277.º, 278.º e 307.º | Caducidade por morte, reforma, insolvência ou extinção do empregador: 50% do salário base por ano. | Conforme. O caso do art. 278.º, n.º 2 (caducidade por força maior ou por prisão, quando é o empregador que fica impedido) não tem opção própria: usar «extinção do empregador». |
| 280.º | Mútuo acordo escrito, em duplicado, com data de efeito e de pagamento. | Conforme (nota e minuta) |
| 286.º, 287.º e 288.º, n.º 2 | Despedimento por causas objectivas: aviso de 30 dias; 15 dias de dispensa remunerada (motivos não económicos); compensação disponível até ao fim do aviso. | Conforme |
| 293.º | Despedimento colectivo: aviso de 60 dias e mapa para o Centro de Emprego. | Conforme (o aviso; o mapa não é gerado) |
| 305.º | Demissão: aviso de 30 dias; a falta é descontada. | Conforme |
| 308.º | Compensação objectiva ou colectiva: 1 salário base por ano até 5 anos, mais 50% por ano acima disso. | Conforme |
| 310.º | Despedimento ilícito ou indirecto: 1 salário base por ano, mínimo de 3. | Conforme |
| 311.º | Fracção de ano igual ou superior a 3 meses conta 1 ano. | Conforme |

## Pontos fora do motor (decisão do dono)

- **Adicional de turnos rotativos e nocturno (arts. 162.º e 182.º):** configurar como subsídio da empresa, por dia ou fixo. O motor não o aplica sozinho porque a lei exclui os regimes de dois turnos.
- **Limite de 8 dias pagos de assistência à família (art. 226.º, n.º 3):** o RH controla ao aprovar a falta.
- **Mapa do despedimento colectivo para o Centro de Emprego (art. 293.º, n.º 2):** não é gerado pela plataforma.
