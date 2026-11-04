# INSS no processamento e lançamentos em lote

Data: 4 de Novembro de 2026. Âmbito: repartição das contribuições do regime geral entre trabalhador e entidade empregadora, apresentação e gravação de variáveis mensais em lote.

## Resultado da auditoria

O motor já separava a retenção do trabalhador do encargo da empresa. A apresentação juntava-os num cartão «INSS (3% + 8%)», tornando ambíguo o que afectava o líquido. A folha passa a mostrar cartões e colunas separados para trabalhador, empresa e custo total.

| Percurso | Regra verificada | Resultado |
|---|---|---|
| Motor salarial | INSS do trabalhador = base contributiva × 3%; INSS da empresa = base contributiva × 8% | Valores e tipos de linha separados |
| Líquido | Ilíquido − INSS do trabalhador − IRT − outros descontos | A parcela patronal fica fora dos descontos |
| Custo da empresa | Ilíquido + contribuição patronal | Inclui os 8% |
| Recibo | Tabela de descontos contém linhas `deduction`; parcela patronal tem tipo `employer` | Encargo da empresa apresentado separadamente |
| Lançamento PGC | Parcela patronal a débito de custos; dívida ao INSS reúne trabalhador e empresa; remunerações a pagar usam o líquido | A contribuição patronal fica em custo da empresa e não reduz a dívida salarial |
| Mapa e obrigação do INSS | Entrega ao INSS soma as duas parcelas | O total de 11% representa a obrigação contributiva conjunta |

Exemplo, antes de IRT e outros descontos: remuneração contributiva de 100.000 Kz → trabalhador 3.000 Kz; empresa 8.000 Kz; líquido 97.000 Kz; custo da empresa 108.000 Kz; entrega ao INSS 11.000 Kz.

Referências primárias: [Decreto Presidencial 227/18, artigo 12.º, publicado pelo INSS](https://portal.inss.gov.ao/wp-content/uploads/2021/10/227_18.pdf), [explicação do MAPTSS sobre a repartição das contribuições](https://maptss.gov.ao/incentivo-a-adesao-ao-inss/). Os enquadramentos contributivos especiais têm taxas próprias; este trabalho verifica a repartição do regime geral parametrizado no Kianda.

## Trabalho em lote no mês

O cálculo da folha mensal já abrange toda a equipa elegível. Em **Preparar processamento / Rever preparação** e no separador **Variáveis**, o botão **Lançar em lote** permite seleccionar colaboradores, aplicar um valor comum, ajustar valores por pessoa e guardar um prémio, abono, adiantamento ou desconto em conjunto.

A lista tem pesquisa e páginas de 50 pessoas. A selecção e os valores mantêm-se entre páginas; o resumo conta todo o lote seleccionado. Cada lote admite até 1.000 colaboradores, com um valor por pessoa. Depois de guardar, **Calcular folha / Recalcular** aplica as variáveis à folha mensal da equipa. O fecho continua a ser uma acção explícita do perfil autorizado.

O endpoint `POST /v1/payroll-variables/batch` valida empresa, perfil, contratos elegíveis no mês, duplicados, valores, tamanho e estado do mês. Grava todas as variáveis e a auditoria numa única transacção. Um colaborador inválido provoca rollback do lote inteiro. Meses fechados rejeitam novos lotes.

Cada pedido tem um identificador único e uma impressão digital dos valores efectivamente gravados. Repetir o mesmo pedido, incluindo em concorrência ou depois de uma resposta perdida, devolve o resultado original. Reutilizar o identificador para outros valores é recusado. A reserva usa a chave primária do registo de auditoria na própria transacção; não há tabelas ou migrações novas.

## Evidência de validação

Os testes cobrem o líquido e o custo com valores conhecidos, a invariância do líquido ao variar apenas a parcela patronal, o recibo, o lançamento PGC e o mapa do INSS. Os testes de lote cobrem concorrência, repetição, rollback, isolamento entre empresas, perfis, tipos de variáveis e meses fechados. No navegador verificam a selecção por pessoa, valores comuns e excepções, cancelamento, manutenção da selecção entre páginas e utilização no telefone.

Testes e publicações usam empresas sintéticas; nenhuma folha, pagamento ou remuneração de clientes é recalculada automaticamente por publicar esta alteração.
