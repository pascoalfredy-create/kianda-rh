# Copilotos do Kianda RH, Integra e Valora

## Estado e utilização

Os três especialistas partilham a autenticação e as licenças existentes. Abrem em **Módulos → Copilotos**, ou no botão **Copiloto** do Integra/Valora. A escolha do módulo apresenta temas e instruções próprios:

| Módulo | Âmbito |
| --- | --- |
| RH | Legislação laboral angolana, contratos, remuneração, IRT/INSS, férias, assiduidade, cessação e recrutamento |
| Integra | Viabilidade, pressupostos, demonstrações integradas, VAL/TIR, WACC, dívida, cenários e risco |
| Valora | Análise de demonstrações, qualidade dos dados, margens, liquidez, orçamento, tesouraria e avaliação |

Os guias funcionam sem IA. A conversa generativa usa a Responses API da OpenAI e fica explicitamente indisponível enquanto a plataforma não configurar **chave, modelo e activação**. Não é apresentada uma resposta fixa como se tivesse sido gerada por IA.

O conhecimento local tem versão e referências. As regras de cálculo RH actualmente disponíveis são as do pacote `AO-2026.2`. O copiloto não pesquisa legislação nem preços em tempo real. Para outro exercício ou regime, alterações legais, acordos e situações concretas, é necessário confirmar os diplomas e as regras aplicáveis. As respostas apoiam a revisão profissional; não executam decisões ou alterações.

## Activação em produção pelo proprietário

1. Na conta OpenAI da plataforma, preparar uma chave de API e escolher um modelo de texto disponível nessa conta. A subscrição ChatGPT não configura esta integração nem substitui a utilização da API.
2. Em [GitHub → Settings → Secrets and variables → Actions](https://github.com/pascoalfredy-create/kianda-rh/settings/secrets/actions), criar o **secret** `KIANDA_OPENAI_API_KEY`. Nunca colocar a chave em código, no navegador ou numa conversa.
3. Em [Actions variables](https://github.com/pascoalfredy-create/kianda-rh/settings/variables/actions), definir:

| Variável | Valor |
| --- | --- |
| `KIANDA_AI_MODEL` | Identificador exacto do modelo escolhido e disponível na conta |
| `KIANDA_COPILOT_AI_ENABLED` | `true` para activar a conversa; `false` para a suspender |
| `KIANDA_COPILOT_DAILY_LIMIT` | Limite de pedidos por empresa e dia de Angola; por omissão `100` |

4. Executar **Actions → CI e publicação → Run workflow → main**. A publicação transfere a configuração para o Worker da API, sem apresentar valores dos secrets nos logs.
5. Confirmar os três copilotos com perguntas sintéticas e rever custos/limites no fornecedor. A API limita ainda a 20 pedidos por utilizador por hora. Pedidos falhados após reserva contam para a quota; não há repetições automáticas de chamadas à IA.

A activação utiliza créditos da conta de API. Para desligar, definir a variável de activação como `false` e publicar novamente. Os guias permanecem disponíveis. A integração não cria contas, não compra créditos e não configura uma chave por si só.

## Dados e permissões

- A conversa exige consentimento para enviar a pergunta e até seis mensagens anteriores ao fornecedor. Fica apenas na memória do ecrã; limpar, trocar projecto ou sair elimina o histórico local. O Kianda grava apenas metadados de utilização e não o texto das perguntas/respostas.
- A chamada define `store: false`. Isto desactiva o armazenamento das respostas para consulta via API; não constitui uma promessa de retenção zero fora das condições e controlos da conta do fornecedor.
- O RH não recebe automaticamente fichas, salários individuais, CV, NIF, IBAN ou documentos. Os guias encaminham cálculos para os motores existentes.
- Integra e Valora permitem rever um **resumo numérico opcional** do projecto/análise guardado. A IA só o recebe com autorização expressa da revisão corrente. Nomes, NIF, notas livres e documentos ficam fora do resumo. Uma revisão alterada exige voltar a consultar e autorizar o contexto.
- Os projectos respeitam empresa, membro activo, sectores contratados e atribuições individuais. Um leitor autorizado pode perguntar sem obter poderes de edição. O Valora mantém as regras existentes de acesso ao módulo. A activação do proprietário ocupa o mesmo lugar de utilizador contabilizado pelos módulos.
- O contexto Integra vem do motor central. O contexto Valora resume o último exercício histórico, em **milhões de Kz**, com as definições da interface; não é apresentado como DCF ou previsão recalculada.
- Antes de sair dos módulos financeiros, o botão do copiloto aguarda a gravação. Não há ferramentas para alterar dados, fechar folhas, contratar, rejeitar ou aprovar pagamentos.

## Implementação e verificação

O pedido valida acesso, contexto e quota numa transacção RLS curta; a chamada externa só começa depois do commit, através do callback `afterTenant`. Não mantém bloqueios nem ligações PostgreSQL durante a espera pela IA. A quota por empresa é serializada para impedir ultrapassagem em concorrência. As mensagens de erro não expõem respostas do fornecedor nem credenciais.

Testes cobrem: separação de especialistas, resultados e unidades dos motores, exclusão de texto livre do contexto, activação explícita, contrato da Responses API com fornecedor simulado, consentimento, versões, sectores/membros/projectos, isolamento de empresas, quotas concorrentes e chamada externa após commit. O navegador verifica guias, acesso directo nos módulos, contexto não autorizado por omissão e telefone. Nenhum teste contacta a IA com uma chave real ou dados de clientes.

Documentação do fornecedor: [Responses API e armazenamento](https://developers.openai.com/api/docs/guides/migrate-to-responses).
