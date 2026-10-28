# Conversão de moeda nos Pressupostos

O selector de moeda passa a converter os montantes, em vez de mudar apenas a identificação. O ecrã e o CSS aprovados ficam preservados. Utiliza a janela modal existente para indicar a taxa.

1. Em **Pressupostos → Geral**, escolha Kz, USD ou EUR.
2. A janela apresenta a **moeda real dos valores actuais**, taxa por uma unidade da origem, data e fonte. Pré-preenche a última referência do BNA publicada através do Frankfurter, identificando a data efectiva; uma referência com mais de sete dias é assinalada. Se a consulta falhar, os campos permitem uma taxa manual — não se inventa uma taxa.
3. Confirme a taxa e prima **Aplicar conversão**. **Cancelar** conserva a moeda e os valores.

Se antes desta correcção tinha mudado apenas o símbolo, indique na janela a **moeda em que os números foram realmente introduzidos**. Por exemplo, se números em USD ficaram identificados como EUR, escolha USD como destino e USD como origem real: taxa 1 corrige a identificação. Não há correcção automática de projectos antigos, pois não é possível deduzir a unidade real dos valores a partir do símbolo guardado.

São convertidos preços unitários das receitas; custos anuais de pessoal, FST e outros; CAPEX; capital inicial; caixa mínima; montante da dívida; imobilizado, existências, clientes, caixa, fornecedores e dívida de abertura; residual líquido. Quantidades, rampas, dias, anos, percentagens, múltiplos e factores de cenários mantêm-se. Os preços unitários preservam precisão inferior a um cêntimo; o motor continua a arredondar fluxos monetários a cêntimos.

O câmbio é fixo nesta operação. Inflação, juros e taxa de desconto exigem revisão para a nova moeda; não se deduzem de um câmbio à vista. Não há actualização automática posterior dos montantes quando o mercado muda. Balancetes e cópias importadas do RH conservam a moeda da sua origem; as versões aprovadas conservam também os PDFs e os resultados anteriores à conversão.

A moeda e todos os montantes são gravados numa única transacção com controlo de revisão e auditoria. A gravação genérica não permite alterar só a moeda. A última conversão fica identificada nos pressupostos e nos sete relatórios projectados, com taxa, data e fonte. A alteração do EUR também corrige as legendas monetárias e a indicação de inflação, que antes exibiam Kz/USD.

A moeda é global para os mapas actuais do projecto: investimento, custos, DRE, Balanço, fluxos, financiamento, avaliação, cenários e PDFs projectados. Os cabeçalhos identificam **Moeda global**. Nos pressupostos, os montantes editáveis, totais e amortizações do investimento são apresentados em unidades da moeda escolhida. Nos mapas calculados, o selector Unidades/Milhares/Milhões altera apenas a escala de apresentação, mantendo a mesma moeda. As indicações de financiamento e desconto usam também a moeda seleccionada. Os balancetes históricos identificam a moeda da fonte e as versões aprovadas conservam a moeda em que foram aprovadas.

## Integração

- `GET /v1/modeling/exchange-rate?from=USD&to=Kz`: consulta identificada; sem montantes nem identificadores enviados ao fornecedor.
- `POST /v1/modeling/models/:id/convert-currency`: `{ revision, from, to, rate, rateDate, source, reference? }`. `from` é a unidade real declarada; a identificação anteriormente guardada fica em `currencyConversion.storedFrom`.
- `reference: true` verifica novamente o par, taxa e data no fornecedor; taxas manuais ficam identificadas como indicadas pelo utilizador.
- Acesso de consulta, outras empresas, projectos arquivados e licenças suspensas não podem converter.
- Sem migração, secrets, novo repositório, alteração de licenças ou preços.

Documentação da fonte: [Frankfurter — fornecedor BNA](https://frankfurter.dev/providers/bna/), [API v2](https://frankfurter.dev/). O endpoint é limitado ao fornecedor BNA, não à média de vários bancos.
