# Integra — módulo independente e motor financeiro

## Contrato do produto

Mesmo repositório, autenticação e PostgreSQL. RH e Modelagem têm direitos independentes. A interface aprovada fica intacta: esta alteração não modifica `apps/web` nem o protótipo HTML.

O backend disponibiliza persistência, direitos comerciais e o motor financeiro anual, com templates para os oito sectores. Ainda não liga os ecrãs do protótipo à API, não cria versões aprovadas nem automatiza a cobrança da Modelagem. Não confundir `revision` (controlo de concorrência) com versões de comité/banco.

## Compatibilidade comercial

- RH mantém `subscriptions`, escalões, cobranças e datas existentes. Ausência de `company_modules.hr` preserva esse comportamento.
- `company_modules.hr.enabled=false` permite desactivar RH para uma empresa que só utiliza Modelagem. Não existe um segundo calendário de pagamento RH.
- Modelagem exige uma linha explícita em `company_modules`, `enabled=true` e uma licença válida. Uma licença RH não concede Modelagem.
- Licença expirada/suspensa conserva leitura dos modelos contratados; escritas ficam bloqueadas. Desactivar `enabled` retira também acesso de leitura.
- Os serviços comuns ficam utilizáveis com Modelagem activa mesmo que o RH esteja suspenso. Gestão de utilizadores e dados continua sujeita às permissões existentes.
- Só administradores da plataforma podem alterar direitos. Nenhuma licença de Modelagem é activada pela migração. Preços e checkout da Modelagem ficam para uma entrega posterior.

## API

| Método e rota | Contrato |
| --- | --- |
| GET `/v1/modules` | Estado de RH e Modelagem para proprietário/Finanças |
| PUT `/v1/platform/companies/:id/modules/:module` | Administração técnica dos direitos; `module=hr|modeling`; `enabled`, `status`, `trialEndsAt`, `paidUntil` |
| GET/POST `/v1/modeling/models` | Listar/criar modelos da empresa; participantes autorizados (escrita: editor) |
| GET/PUT `/v1/modeling/models/:id` | Consultar/editar; edição exige `revision` actual, conflito devolve 409 |
| POST `/v1/modeling/models/:id/import-personnel` | Cópia explícita de custos do RH; exige ambos os módulos activos e `revision` actual |

Modelo: `name`, `sector` (as oito chaves do protótipo), `currency` (`Kz`, `USD`, `EUR`) e `assumptions` (objecto do protótipo, até 200 000 caracteres). Sem importação, `assumptions.pessoal` é introduzido manualmente.

Importação do orçamento: `{source:'budget', budgetId, revision}`. Só orçamentos aprovados da própria empresa. Soma `costMinor` (ilíquido + encargos do empregador) do ano; efectivo mensal apenas como referência. Meses sem linha têm zero.

Importação real: `{source:'actual', from:'AAAA-MM', to:'AAAA-MM', revision}`. Exige exactamente 12 meses consecutivos, todos com processamento fechado. Soma ilíquido e INSS patronal. Não transforma meses em falta em zero nem anualiza períodos incompletos.

Se a moeda do modelo não é Kz, `exchangeRate` é obrigatório: **unidades da moeda de destino por 1 Kz**. Não há consulta automática de câmbio. Em Kz, a taxa é 1. Não se aplica inflação adicional à cópia de origem; o motor aplica os pressupostos de projecção do modelo.

O campo anual `assumptions.pessoal` usa unidades da moeda do modelo (compatível com o protótipo). Na cópia de origem, `totalMinor` e `months[].costMinor` são cêntimos de Kz. A importação guarda taxa, moeda, período, origem, data e utilizador, sem identificação de colaboradores ou salários individuais. Alterações futuras no RH não a modificam. Uma nova importação cria novo registo e preserva o anterior. Alterações manuais posteriores dos pressupostos não apagam o histórico da importação.

## Dados e segurança

Migração `0028_integra_modules`: `company_modules`, `financial_models`, `financial_personnel_imports`, com RLS. Incluídas na exportação e eliminação da empresa. O papel da aplicação não pode alterar licenças nem editar/apagar o histórico de importações. Administração da plataforma continua fora da transacção de empresa e com verificação de administrador.

Cada gravação/importação é auditada. `revision` impede que uma gravação com dados antigos substitua a de outro utilizador. A importação e a actualização do modelo pertencem à mesma transacção do pedido: um erro desfaz ambas.

## Validação

Testes de core para adesão explícita, tolerância, suspensão, cancelamento, experimental e classificação de rotas. Testes de API com PostgreSQL para autorização, isolamento, revisões, importação, preservação da cópia, câmbio, separação de licenças e protecção dos direitos no banco. Os testes de banco são omitidos se `DATABASE_URL` não estiver definida; o CI do repositório disponibiliza PostgreSQL e aplica as migrações antes de os executar.

## Modelo comercial aprovado — projectos e acessos

Modelagem tem preço próprio, independente do número de funcionários e dos escalões RH. Os montantes comerciais ainda não foram definidos: nenhum preço foi inventado, nenhum cliente foi cobrado e nenhum plano pago foi activado nesta alteração.

- `projectLimit`: número de projectos activos contratados, configurado pela plataforma. O valor técnico por omissão é 1 e pode ser ajustado por empresa; não constitui uma tabela comercial aprovada.
- Até **5 utilizadores autorizados no Integra**, incluindo o proprietário da empresa cliente. Cinco acessos não significam cinco empregados no RH. O proprietário gere os participantes e as permissões `editor`/`viewer`; uma pessoa sem ficha de funcionário também pode participar.
- `extraUsers`: acessos adicionais contratados explicitamente para equipas maiores. Só a plataforma os altera. O valor unitário por participante e a periodicidade de cobrança ficam por definir.
- Um projecto corresponde ao registo `financial_models`. Alterar pressupostos não consome outro projecto. Versões/cenários futuros devem pertencer ao mesmo projecto, sem consumir quotas adicionais.
- Arquivar liberta quota de projectos e mantém histórico e consulta. Projectos arquivados não podem ser editados nem receber importações. Restaurar exige vaga. Criação/restauro e admissão de utilizadores são serializados por empresa para impedir ultrapassagem por pedidos concorrentes.
- O número de utilizadores autorizados conta os membros com `enabled=true`. Desactivar o acesso no Integra liberta lugar. A suspensão do utilizador no RH não altera automaticamente o contrato de acessos Integra.
- Os participantes desta entrega têm acesso aos projectos da própria empresa segundo a permissão global Integra; atribuição restrita a projectos individuais é uma evolução pendente.

### Rotas adicionais

| Método e rota | Função |
| --- | --- |
| GET `/v1/modeling/usage` | Consumo e limites de projectos e utilizadores |
| GET `/v1/modeling/members` | Participantes; reservado ao proprietário cliente |
| PUT `/v1/modeling/members/:userId` | Conceder/retirar acesso a um utilizador da mesma empresa; `enabled`, `permission` |
| POST `/v1/modeling/models/:id/archive` | Arquivar/restaurar com `{archived, revision}` |
| GET `/v1/modeling/export-options` | Política de formatos da conta autenticada |

A rota administrativa dos direitos aceita agora `projectLimit` e `extraUsers` na Modelagem. Omiti-los numa renovação conserva os valores anteriores. Reduções abaixo do consumo actual são recusadas. O módulo RH continua sem cobrança por projectos.

### PDF para clientes; Excel exclusivo do proprietário da plataforma

A política de exportação da Modelagem permite PDF aos clientes. Excel (`xlsx`) exige a combinação de: identificador exactamente igual a `KIANDA_MODELING_OWNER_USER_ID`, conta autenticada e estatuto de administrador da plataforma. Ser `owner` de uma empresa cliente ou outro administrador da plataforma não concede Excel. Sem configuração do identificador exclusivo, Excel fica recusado para todos. CSV e outros formatos editáveis não fazem parte do produto cliente.

Configuração de produção: definir a variável de repositório `KIANDA_MODELING_OWNER_USER_ID` com o ID da conta do proprietário do produto. O CI transmite essa configuração ao Worker. Não se infere identidade pelo nome, nem se concede a todos os administradores.

**Os exportadores financeiros ainda não existem nesta entrega.** A política e o endpoint de capacidades estão preparados; quando os exportadores forem implementados, a rota de download deve usar `canExportModeling` no servidor e validar também acesso ao projecto. Nenhum Excel pode ser publicado em URL estática/pública. A exportação JSON de portabilidade dos dados da empresa continua separada dos relatórios comerciais e das fórmulas/modelos Excel do produto. As exportações RH existentes não são alteradas por esta regra do Integra.

## Motor financeiro anual — `integra-1.0.0`

Código puro em `packages/core/src/modeling/`. Não depende de RH, base de dados, DOM, `localStorage` ou relógio. Os campos de pressupostos mantêm os nomes do protótipo aprovado; a apresentação continua intacta. Guardar rascunhos incompletos continua permitido, mas calcular exige validação completa.

### API de cálculo

| Método e rota | Resultado |
| --- | --- |
| GET `/v1/modeling/templates` | Oito templates completos, isolados entre chamadas, identificados como demonstrativos |
| GET `/v1/modeling/templates/:sector` | Template específico, com moeda e pressupostos editáveis |
| POST `/v1/modeling/simulate` | `{assumptions, overrides?}` → cálculo sem persistência; exige editor e licença com escrita |
| GET `/v1/modeling/models/:id/calculation` | Cálculo da revisão guardada; query opcional `scenario=base|otim|pess` e `revision` |
| GET `/v1/modeling/models/:id/scenarios` | Base, optimista e pessimista sem criar projectos adicionais |
| GET `/v1/modeling/models/:id/sensitivity` | Tornado por preço, volume, custos variáveis, custos fixos, CAPEX e WACC; preço break-even |

Os resultados calculados a partir de modelos guardados incluem metadados de origem (`sourceRevision`, hash SHA-256 canónico dos pressupostos/moeda/sector) e versão do motor. A ordem das chaves JSON não altera o hash. Uma revisão explicitamente pedida que já mudou devolve 409. Pressupostos financeiros inválidos devolvem 422 com campos e motivos; números fora do intervalo suportado não são convertidos silenciosamente em `null`.

Calcular a revisão de um projecto arquivado não o restaura nem consome nova quota; licenças em consulta mantêm leitura/cálculo de dados guardados. Estes cálculos não são snapshots históricos imutáveis: serão congelados na entrega de versões aprovadas. As simulações novas por POST exigem escrita. Nenhum endpoint devolve ficheiros Excel nem fórmulas de Excel aos clientes.

### Convenções e correcções do protótipo

- Horizonte: ano 0 mais 1–40 anos. Montantes de entrada e saída em unidades da moeda do projecto; operações monetárias e reconciliações em cêntimos inteiros, com arredondamento por rubrica. Volumes, taxas e desconto conservam precisão fraccionária. Valores que excedam a precisão segura são recusados.
- Receitas por quantidade × preço, rampa de arranque e crescimento; custos variáveis/fixos, royalties e manutenção. Numa empresa existente, a operação começa no ano 1 e ignora a rampa.
- CAPEX faseado e de manutenção, amortização linear com acerto da última parcela; início no ano seguinte à aquisição ou no início da operação, consoante o mais tardio. O imobilizado de abertura representa valor líquido contabilístico, não um custo histórico bruto reconstruído.
- Dívida nova e de abertura: juros pagos, prestações de capital constantes e carência de principal. `divida.jurosDesembolso` parametriza a fracção de juros no ano do desembolso (por omissão 50%, como no protótipo). Taxa de juro zero é respeitada. O ano 0 pode incluir CAPEX e juros iniciais; não é um período anual de covenant DSCR.
- Tributação parametrizada sobre o resultado, com utilização FIFO de prejuízos e validade editável `prejuizosAnos` (por omissão 5). Não se reconhecem reembolsos de imposto fictícios em anos de prejuízo. As taxas e os regimes dos templates são exemplos do protótipo, **não uma validação da legislação de cada sector**; o motor não implementa um regime petrolífero completo.
- Fundo de maneio por dias (base 365): clientes sobre receitas, existências sobre custos variáveis e fornecedores sobre custos variáveis + FST. A abertura existente é respeitada; só a variação entra nos fluxos projectados.
- `capitalAutomatico=true` conserva o mecanismo do protótipo, mas identifica os aportes adicionais. Com `false`, o défice fica visível em caixa/`unfunded`, sem aportes fictícios. `fullyFunded=false` e TIR do accionista indisponível. Uma caixa negativa neste modo é diagnóstico de financiamento, não um balanço aprovado para emissão.
- Dividendos limitados ao resultado positivo do período, lucros acumulados disponíveis e caixa acima do mínimo.
- TIR do projecto sobre FCFF. TIR do accionista sobre dividendos menos aportes efectivos (incluindo adicionais), mais o valor final realizável: valor terminal/residual + caixa final − dívida final, com mínimo de zero. `valuationFlows` explicita os fluxos usados; `k.fcfe` continua a mostrar fluxo potencial disponível, distinto do efectivamente recebido.
- Empresas existentes apresentam DCF/EV e valor do capital próprio (EV − dívida líquida de abertura). Não se inventa um preço de aquisição para apresentar TIR ou payback. Expansão no ano 0 entra no DCF, em vez de ser apagada.
- WACC manual ou CAPM. Gordon exige WACC superior a g, inclusive após stress; igualdade numérica próxima é recusada. Valor residual líquido e libertação de fundo de maneio são opcionais em projectos finitos e incompatíveis com valor terminal de continuidade, para evitar dupla contagem.
- VAL inclui CF0. Para comparar com Excel: `CF0 + NPV(taxa, CF1:CFn)`. PI = valor actual dos fluxos positivos / valor actual absoluto dos negativos. Payback simples/descontado usa fluxos explícitos, sem valor terminal; a duração é também devolvida em anos e meses separados.
- TIR por bissecção no logaritmo do factor de desconto, incluindo taxas negativas próximas de −100% e retornos elevados. Sem mudança de sinal: indisponível. Com múltiplas mudanças: indisponível com motivo explícito, sem escolher arbitrariamente uma das possíveis raízes.
- Os covenants preservam os três limites do protótipo (DSCR, dívida líquida/EBITDA e EBITDA/juros) e devolvem cumprimento por ano ou `null` quando o rácio não é significativo. A comparação EV/EBITDA usa o ano 1, explicitamente identificado, e não substitui o DCF; EBITDA não positivo não recebe múltiplo de avaliação.
- DSCR inclui os anos 1 em diante com serviço de dívida, mesmo só com juros e mesmo antes da operação. LLCR só é apresentado quando uma única facilidade é identificável e o horizonte cobre o vencimento. Duas dívidas com calendários/taxas distintos não são agregadas usando uma taxa arbitrária. A capacidade de endividamento é indicativa (VA do CFADS / DSCR alvo), sem substituir a verificação dos covenants ano a ano.
- Cenários e sensibilidades não modificam os pressupostos. Multiplicador zero significa zero, sem ser substituído por um. O break-even pesquisa multiplicador de preço entre 0 e 512 e devolve `null` se não encontra raiz; fluxos ao cêntimo tornam a raiz aproximada.

### Verificação do motor

Referências analíticas independentes para VAL, TIR, payback, PI e retorno do accionista. Oito sectores × três cenários, em projecto novo e empresa existente, com reconciliação exacta de balanço e caixa. Testes de dívida/carência/juros zero, prejuízos e expiração, amortizações ao cêntimo, dividendos, défices, terminal/residual, entradas inválidas e precisão. Não foi fornecido um Excel de referência do proprietário: não se afirma confronto com um ficheiro externo não recebido.
