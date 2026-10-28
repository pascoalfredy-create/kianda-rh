# Integra — módulo independente e motor financeiro

## Contrato do produto

Mesmo repositório, autenticação e PostgreSQL. RH e Modelagem têm direitos independentes. A interface aprovada é reutilizada na rota autenticada `/modelagem`, sem redesenho: o CSS e a estrutura HTML do protótipo são preservados. Os ecrãs, menus e estilos RH existentes não são alterados.

O backend disponibiliza persistência, direitos comerciais e o motor financeiro anual, com templates para os oito sectores. Os ecrãs de projecção estão ligados à API para carregar, criar, duplicar, gravar e exportar PDF. O backend também cria versões aprovadas; a selecção/aprovação de versões, a importação RH e a gestão de participantes ainda não têm novos controlos na interface. Não confundir `revision` (controlo de concorrência) com versões de comité/banco. A cobrança da Modelagem ainda não foi automatizada.

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
| GET `/v1/modeling/session` | Empresa, identidade, permissão efectiva, possibilidade de escrita, limites e formatos para qualquer participante autorizado |
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

Os exportadores financeiros estão implementados e verificam a política de formatos e o acesso ao projecto no servidor. Nenhum Excel pode ser publicado em URL estática/pública. A exportação JSON de portabilidade dos dados da empresa continua separada dos relatórios comerciais e das fórmulas/modelos Excel do produto. As exportações RH existentes não são alteradas por esta regra do Integra.

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

Calcular a revisão de um projecto arquivado não o restaura nem consome nova quota; licenças em consulta mantêm leitura/cálculo de dados guardados. Estes endpoints calculam o rascunho corrente; para um snapshot imutável deve utilizar-se uma versão aprovada e as respectivas rotas de relatório. As simulações novas por POST exigem escrita. Os endpoints de cálculo não exportam ficheiros Excel; a rota própria de exportação permite XLSX exclusivamente à conta proprietária do produto.

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

## Versões aprovadas e downloads

Aprovar uma versão congela a revisão corrente, os pressupostos originais, a normalização usada pelo motor, os cálculos dos três cenários, as sensibilidades, as tabelas dos relatórios e os dados da entidade promotora. O hash da origem e o hash do conteúdo permitem conferir a proveniência e a integridade. O promotor pode ser indicado pelos campos opcionais `assumptions.promotor` e `assumptions.promotorNif`, já compatíveis com o conceito do protótipo; na ausência, utiliza-se a empresa do projecto.

A aprovação da versão é uma fixação de dados pelo proprietário da empresa cliente. Não preenche nem substitui a deliberação do comité de investimento. O rascunho do projecto continua editável e poderá dar origem a outra versão. Versões não consomem novas quotas de projectos ou utilizadores.

| Método e rota | Contrato |
| --- | --- |
| POST `/v1/modeling/models/:id/versions` | Só o proprietário cliente: `{revision, label}`. Recusa revisão desactualizada, projecto arquivado ou pressupostos incompletos. Mesmo rótulo e revisão devolvem a mesma versão, sem duplicar um pedido repetido |
| GET `/v1/modeling/models/:id/versions` | Metadados das versões aprovadas, por ordem decrescente |
| GET `/v1/modeling/models/:id/versions/:versionId` | Conteúdo congelado, com verificação dos hashes |
| GET `/v1/modeling/models/:id/reports` | Catálogo de relatórios e formatos permitidos para a conta |
| GET `/v1/modeling/models/:id/reports/:reportKey?format=pdf` | Relatório do rascunho; pode exigir `revision` para impedir exportação desactualizada e `scenario=base\|otim\|pess` para consulta sem escrita |
| GET `/v1/modeling/models/:id/reports/:reportKey?format=pdf&version=:versionId` | Relatório a partir da versão aprovada, sem recalcular o rascunho nem consultar novamente o RH |
| GET `/v1/modeling/models/:id/reports/:reportKey?format=xlsx&version=:versionId` | Excel de resultados, apenas para o ID exclusivo do proprietário do produto com estatuto de administrador da plataforma |

Formatos diferentes de PDF/XLSX são recusados. Uma URL directa de Excel não contorna a autorização. PDF é permitido aos participantes com consulta; rascunhos incompletos não produzem ficheiros vazios, mas erro 422. O cenário escolhido em consulta entra na cópia temporária de cálculo, sem gravar no projecto; o hash corresponde aos pressupostos com esse cenário e o cabeçalho `x-source-scenario` identifica-o. Uma versão aprovada não admite substituição do cenário. Projectos arquivados e licenças em modo de consulta preservam downloads de versões aprovadas. As operações de aprovação e exportação têm registo de auditoria. Os ficheiros são respostas privadas, sem cache e sem ligações públicas estáticas.

A migração `0030_integra_approved_versions` cria `financial_model_versions` com RLS e chave estrangeira para o projecto. Um trigger impede actualizações, mesmo pelo utilizador dono das tabelas; o papel da aplicação também não pode apagar versões. A eliminação integral autorizada da empresa pela plataforma continua possível e elimina as versões antes do projecto. Não existe endpoint de edição ou eliminação individual de versões.

### Relatórios disponíveis

Sete relatórios de projecção foram implementados: sumário executivo, memorando para comité, memorando de crédito, avaliação, demonstrações projectadas, cenários/sensibilidade e serviço da dívida. Os títulos, o papel A4, os destaques azuis, o corpo serifado e as tabelas seguem a estrutura do protótipo. DR, Balanço e Fluxos começam em páginas distintas. Tabelas extensas repartem os anos por bandas com rubricas e cabeçalhos repetidos; não se eliminam anos nem se reduz a fonte para encaixar quarenta períodos numa página.

O oitavo relatório do protótipo, `analise`, é histórico e exige balancetes analisados. O catálogo apresenta-o como indisponível e a rota devolve `historico_em_falta` (422). Não se apresentam projecções como se fossem demonstrações históricas.

O PDF contém apenas páginas vectoriais e fontes incorporadas, com suporte a acentos e caracteres cirílicos, sem JavaScript ou anexos Excel. O renderizador funciona em Node/Cloudflare sem navegador, fontes de rede ou serviços externos. As fontes DejaVu e a licença acompanham o código; o script `scripts/build-financial-fonts.py` permite reproduzir os subconjuntos. Os recursos das fontes são reutilizados no processo para evitar descodificações repetidas.

O XLSX é uma **exportação dos resultados**, com números e percentagens tipados, identificação da origem e notas. Não é apresentado como modelo financeiro Excel com fórmulas recalculáveis. A restrição exclusiva à conta proprietária é verificada no servidor. O gerador XLSX existente foi estendido com tipos explícitos, formatos percentuais e texto com quebra de linha, preservando os formatos dos mapas RH existentes.

A versão do formato dos relatórios é `integra-reports-1`. Novos formatos devem manter o renderizador anterior para as versões já aprovadas; nunca se deve recalcular uma versão antiga com pressupostos ou regras novas para a descarregar.

### Validação desta entrega

Testes de coerência das tabelas e resultados para os oito sectores; testes de estrutura PDF, fontes, paginação de quarenta anos e ausência de anexos editáveis; leitura independente dos PDFs e do XML/valores/tipos do Excel. Pré-visualizações temporárias não fazem parte da publicação. Os testes de API com PostgreSQL cobrem permissões de aprovação, repetição/concorrência, igualdade binária do PDF aprovado após alterações no rascunho/empresa, isolamento, formatos exclusivos, dados incompletos, arquivo e licença em consulta.

## Ligação da interface aprovada

`/modelagem` é um documento autenticado independente, servido por um Route Handler Next. Reutiliza a sessão Kianda e consulta os direitos efectivos do participante no servidor antes de devolver uma página executável. Sem sessão redirecciona para `/login?voltar=/modelagem`; sem licença ou adesão responde 403; falha do serviço responde 503. Não se altera a navegação RH para acrescentar uma entrada de menu sem autorização de layout.

O original aprovado está em `apps/web/modeling/prototype.html`. `scripts/build-modeling-ui.mjs` preserva byte a byte o CSS e a estrutura anteriores ao JavaScript e monta a adaptação funcional com o motor de `packages/core`. O runtime é público mas não contém dados de empresas; a sessão e as respostas da API são privadas e sem cache. O HTML tem política CSP sem execução dinâmica de código. Não se utiliza `localStorage`, `sessionStorage`, clipboard ou exportação CSV na Modelagem ligada.

Os projectos activos vêm exclusivamente da API; não se criam três demonstrações automaticamente na base de dados. O formulário existente cria projectos novos ou empresas existentes com os oito templates da API. Duplicar é uma criação confirmada pelo servidor e sujeita à quota; uma recusa não deixa um projecto fictício na lista. A selecção de projecto espera pela gravação anterior.

As alterações são agrupadas e gravadas por projecto com revisão obrigatória. Uma edição feita durante uma gravação fica em fila com a revisão seguinte; a resposta anterior não substitui os valores que o utilizador está a escrever. Falhas e conflitos mantêm os dados na memória e bloqueiam novas gravações/downloads com essa origem até recarregar. Sair com alterações por guardar activa o aviso nativo do navegador. Não se afirma haver recuperação de rascunhos após fechar uma página sem rede.

O motor puro partilhado fornece a pré-visualização imediata nos ecrãs; não existe uma segunda implementação do cálculo do protótipo. O servidor valida e calcula os downloads. Um rascunho incompleto pode abrir os pressupostos, mas não recebe projecções preenchidas com dados de exemplo. No modo de consulta os campos ficam bloqueados; cenário e unidade de apresentação são temporários. O download PDF espera pelas gravações e envia revisão/cenário, recusando origens desactualizadas.

Os comandos de cópia das demonstrações e dos relatórios passam a descarregar PDF, conservando as posições e classes existentes. Excel continua exclusivamente na API do proprietário configurado. Não se acrescentaram botões, menus ou formulários de aprovação, RH, licenças ou participantes. A área histórica apresenta a dependência de balancetes persistidos e não guarda dados históricos locais como se fossem dados da empresa.

Verificação: testes de fila/revisão, falha de rede, conflito, consulta, quota e origem do PDF; comparação exacta com o HTML aprovado; isolamento do JSON da sessão; montagem das sete vistas nos oito sectores com o código distribuído. Um teste HTTP local do Next com uma API de teste verificou redireccionamento, recusa de licença, cabeçalhos, proxy, gravação e PDF. Esse teste não substitui os testes PostgreSQL do CI. O navegador remoto não alcançou o servidor local, pelo que não se afirma uma inspecção visual desta integração num navegador real. `pnpm --filter @kianda/web modeling:generate` regenera os ficheiros; o teste web recusa runtime desactualizado.
