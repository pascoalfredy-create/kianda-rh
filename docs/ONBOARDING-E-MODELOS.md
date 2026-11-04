# Cadastro, mês experimental e modelos da empresa

Actualização: 4 de Novembro de 2026.

## Cadastro e escolha comercial

O cadastro público pede empresa, NIF obrigatório de dez dígitos, sector, morada e responsável. Não apresenta planos, ciclos ou montantes. Cria a experiência de RH, Integra e Valora; depois da confirmação do email, a pessoa entra em Módulos e encontra os limites, os acessos e a ligação para planos e pagamento.

Os limites iniciais são os perfis de entrada existentes: RH até 100 colaboradores, Integra até dois projectos e dois sectores, Valora até três análises; os módulos financeiros incluem cinco utilizadores. O sector principal deriva do sector da empresa; o adicional inicial é Serviços ou Comércio. A escolha dos sectores do plano pago continua na licença. A API conserva a compatibilidade com pedidos explícitos de módulos e planos de integrações anteriores; nenhum registo gera uma cobrança.

## Um mês experimental

- Um mês significa **30 dias de calendário**, incluindo o dia da confirmação e o último dia, pela hora de Angola.
- A primeira confirmação do email fixa a data final; reenviar ou repetir a ligação não renova a experiência.
- Permite introduzir dados, calcular e pré-visualizar documentos. Downloads e impressão exigem subscrição paga do respectivo módulo.
- Os testes antigos sem período pago são estendidos para 30 dias desde a criação da empresa. Datas maiores já concedidas, períodos pagos e suspensões/cancelamentos manuais são preservados.
- A tolerância após períodos pagos continua a ser uma regra separada.
- Pedidos de pagamento antigos ainda pendentes são alinhados com a nova data final, conservando referências, montantes e a duração completa do ciclo. Pedidos pagos e datas futuras mais favoráveis são preservados (migração 0049).

## Confirmação do email

Novos proprietários têm confirmação obrigatória. Antes de confirmar, só entram no ecrã da confirmação e nas operações da própria conta permitidas; a API recusa o acesso aos módulos e à contratação, mesmo que se altere a interface ou o token de sessão.

A ligação usa um token aleatório, guardado apenas como hash. Expira em 24 horas, é consumida por POST explícito e só uma vez, com bloqueio transaccional. Visitar o URL não confirma a conta. Reenvios são limitados por IP e por utilizador, e revogam as ligações anteriores. Alterar o endereço torna inválida uma ligação anterior. Uma recuperação de acesso que mude o email remove a confirmação anterior.

Utilizadores anteriores não recebem uma confirmação fictícia nem ficam bloqueados com esta publicação: a obrigação é identificada separadamente da data de confirmação. Convites e PINs de colaboradores conservam o circuito autorizado pela empresa.

### Configuração operacional necessária

O envio real depende de Resend e de um remetente validado:

- GitHub secret: `KIANDA_RESEND_API_KEY`.
- Variável: `KIANDA_MAIL_FROM`, por exemplo `Kianda <nao-responder@dominio-validado>`.
- `APP_BASE_URL` é preenchido pelo domínio principal no workflow.

Estas definições já são encaminhadas pelo workflow para o Worker. Não colocar chaves nos ficheiros, na interface, nos logs ou no repositório. Sem configuração ou se o fornecedor falhar, o sistema informa a indisponibilidade; não simula um email entregue nem confirma automaticamente. A conta fica pendente e pode pedir nova confirmação quando o envio estiver disponível. A entrega real deve ser confirmada pelo responsável antes de anunciar registos autónomos.

Passos para o proprietário:

1. Entrar no Resend e adicionar em **Domains** um subdomínio próprio para envio, por exemplo `notificacoes.yelaperformance.com`. É uma sugestão; só usar depois de o verificar.
2. Copiar exactamente os registos DNS apresentados pelo Resend para o fornecedor DNS do domínio. Activar apenas envio; conservar os registos do site e do correio existente. Aguardar o estado **Verified**.
3. Em **API Keys**, criar `Kianda produção`, com **Sending access** limitado ao domínio validado. A chave só é mostrada uma vez.
4. No repositório `pascoalfredy-create/kianda-rh`, abrir **Settings → Secrets and variables → Actions**. No separador **Secrets**, criar o repository secret `KIANDA_RESEND_API_KEY` com a chave. No separador **Variables**, criar `KIANDA_MAIL_FROM` com, por exemplo, `Kianda <nao-responder@notificacoes.yelaperformance.com>`; usar o domínio realmente validado.
5. Em **Actions → CI e publicação**, executar **Run workflow** na branch `main`. Guardar as definições não altera o Worker já publicado; a publicação é necessária.
6. Pedir o reenvio na conta pendente ou efectuar um cadastro controlado. Confirmar recepção (incluindo spam), clicar no botão de confirmação e verificar o acesso a Módulos. Conferir o estado de entrega no Resend. Não considerar operacional só por a publicação terminar.

Referências: [domínio e DNS](https://resend.com/docs/add-a-domain), [chave de envio](https://resend.com/docs/create-an-api-key), [secrets do GitHub](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## Preparação do processamento salarial

**Preparar processamento** abre os campos antes de criar a folha: colaborador, tipo de variável, valor, descrição e incidências; para salários indexados, câmbio, data e fonte. É opcional acrescentar variáveis. O botão **Calcular folha** só prossegue depois de guardar ou cancelar uma variável começada. Cancelar uma preparação sem guardar não cria a folha nem variáveis.

As remunerações continuam nas fichas/contratos, e a assiduidade aprovada continua a fornecer faltas e horas extra. Existem ligações para rever essas origens. Depois do cálculo, **Recalcular** mantém a acção directa e **Rever preparação** reabre os campos. Os mapas continuam recolhidos com **Ver**. Um mês fechado não apresenta controlos de preparação.

A lista de colaboradores usa a mesma abertura da folha (`people=1`), só com identificadores e nomes da própria empresa, para quem pode preparar. Evita outra chamada HTTP e a transmissão das fichas completas.

## Correcção de erros na remuneração

Em **Colaboradores → Contrato e remuneração**, existem duas operações:

- **Registar alteração salarial** cria uma remuneração com data de efeito, para aumentos, ajustes e promoções. Uma data futura mantém o salário actual e apresenta a mensagem «Alteração agendada para…». Para vigorar hoje, seleccionar a data de hoje. A ficha actualiza automaticamente depois de guardar.
- **Corrigir erro de registo** permite escolher a linha original, corrigir os valores e justificar o erro. Conserva a data e o motivo original, sem acrescentar uma redução/aumento fictício. A auditoria regista quem corrigiu, quando, os valores anteriores e novos, e a justificação. A remuneração inicial do contrato acompanha a correcção da admissão; correcções de alterações posteriores não mudam os valores iniciais desse contrato.

Exemplo: USD 300.000 digitados em vez de USD 3.000 na admissão devem ser corrigidos na linha da admissão, mantendo a data original. Uma alteração para USD 3.000 em 01/12 só passa a vigorar em Dezembro. Agendamentos existentes conservam as suas datas e valores; a correcção de outra linha não os elimina.

A percentagem compara a moeda contratada: em USD, compara dólares e não a referência em Kz. Uma alteração do câmbio com o mesmo valor em USD produz 0%; ao mudar de moeda não se inventa uma percentagem de variação.

O endpoint PATCH `/v1/employees/:id/compensation/:changeId` exige perfil RH/proprietário, empresa e colaborador correspondentes, justificação e o retrato dos valores esperados. Recusa sobreposição de gravações. A actualização e a auditoria são transaccionais. Meses já fechados bloqueiam a correcção; documentos e recibos emitidos conservam os valores. Rascunhos precisam de **Recalcular**, com ligação para os períodos afectados na confirmação. Nenhum registo real de remuneração é corrigido automaticamente por uma publicação.

## Mapas recolhidos

As tabelas detalhadas do RH e dos ecrãs financeiros começam recolhidas, com **Ver** e **Recolher**. Os indicadores e gráficos continuam visíveis. O controlo é nativo e funciona com teclado. Nos ecrãs imperativos, o estado aberto mantém-se durante os recálculos da mesma vista; o conteúdo e os exportadores não são reescritos.

## Modelos de contrato da empresa

Em Documentos → Modelos → abrir o contrato, **Importar modelo da empresa** aceita Word DOCX, PDF com texto seleccionável ou TXT, até 10 MB e 30.000 caracteres. Word antigo precisa de ser guardado como DOCX/PDF; documentos digitalizados sem texto precisam de OCR externo.

A importação conserva texto, cláusulas e parágrafos. A paginação, as imagens e a formatação original não são reproduzidas: o documento final utiliza o papel timbrado da empresa configurado no Kianda. Esta limitação fica indicada junto da importação.

O responsável revê o texto, transforma os dados variáveis em campos (`{{empresa.nome}}`, `{{colaborador.nome}}`, etc.) e grava uma nova versão. Existe ajuda para substituir texto por um campo, pré-visualização e opção de remover a importação antes de gravar. Campos `pedido.*` próprios do modelo aparecem na emissão; campos dos modelos base que já não são usados deixam de ser exigidos.

Só depois de gravar o modelo entra em uso para a empresa. A API regista a versão e o nome do ficheiro de origem na auditoria. Documentos emitidos conservam o texto e a versão usados na emissão; outros clientes continuam com os seus próprios modelos. O reset do Kianda e o histórico são conservados.

## Validação

Os testes cobrem duração e datas, NIF e formulário sem planos, visibilidade da palavra-passe, bloqueio antes de confirmar, token expirado/inventado/repetido, concorrência, reenvio, indisponibilidade do fornecedor e compatibilidade com utilizadores anteriores. Os testes no navegador exercitam cadastro, mapas recolhidos nos três módulos e leitura/remoção de Word/PDF com emissão conforme o modelo da empresa. O CI usa PostgreSQL real; não são enviados emails nem criadas contas em produção pelos testes.
