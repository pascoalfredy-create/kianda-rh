# Integra — fundação do módulo independente

## Contrato do produto

Mesmo repositório, autenticação e PostgreSQL. RH e Modelagem têm direitos independentes. A interface aprovada fica intacta: esta alteração não modifica `apps/web` nem o protótipo HTML.

Esta primeira entrega prepara persistência e API. Ainda não liga os ecrãs do protótipo à API, não migra o motor financeiro, não cria versões aprovadas nem automatiza a cobrança da Modelagem. Não confundir `revision` (controlo de concorrência) com versões de comité/banco.

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
| GET/POST `/v1/modeling/models` | Listar/criar modelos da empresa; proprietário/Finanças |
| GET/PUT `/v1/modeling/models/:id` | Consultar/editar; edição exige `revision` actual, conflito devolve 409 |
| POST `/v1/modeling/models/:id/import-personnel` | Cópia explícita de custos do RH; exige ambos os módulos activos e `revision` actual |

Modelo: `name`, `sector` (as oito chaves do protótipo), `currency` (`Kz`, `USD`, `EUR`) e `assumptions` (objecto do protótipo, até 200 000 caracteres). Sem importação, `assumptions.pessoal` é introduzido manualmente.

Importação do orçamento: `{source:'budget', budgetId, revision}`. Só orçamentos aprovados da própria empresa. Soma `costMinor` (ilíquido + encargos do empregador) do ano; efectivo mensal apenas como referência. Meses sem linha têm zero.

Importação real: `{source:'actual', from:'AAAA-MM', to:'AAAA-MM', revision}`. Exige exactamente 12 meses consecutivos, todos com processamento fechado. Soma ilíquido e INSS patronal. Não transforma meses em falta em zero nem anualiza períodos incompletos.

Se a moeda do modelo não é Kz, `exchangeRate` é obrigatório: **unidades da moeda de destino por 1 Kz**. Não há consulta automática de câmbio. Em Kz, a taxa é 1. Não se aplica inflação adicional à cópia de origem; o motor futuro aplica os pressupostos de projecção do modelo.

O campo anual `assumptions.pessoal` usa unidades da moeda do modelo (compatível com o protótipo). Na cópia de origem, `totalMinor` e `months[].costMinor` são cêntimos de Kz. A importação guarda taxa, moeda, período, origem, data e utilizador, sem identificação de colaboradores ou salários individuais. Alterações futuras no RH não a modificam. Uma nova importação cria novo registo e preserva o anterior. Alterações manuais posteriores dos pressupostos não apagam o histórico da importação.

## Dados e segurança

Migração `0028_integra_modules`: `company_modules`, `financial_models`, `financial_personnel_imports`, com RLS. Incluídas na exportação e eliminação da empresa. O papel da aplicação não pode alterar licenças nem editar/apagar o histórico de importações. Administração da plataforma continua fora da transacção de empresa e com verificação de administrador.

Cada gravação/importação é auditada. `revision` impede que uma gravação com dados antigos substitua a de outro utilizador. A importação e a actualização do modelo pertencem à mesma transacção do pedido: um erro desfaz ambas.

## Validação

Testes de core para adesão explícita, tolerância, suspensão, cancelamento, experimental e classificação de rotas. Testes de API com PostgreSQL para autorização, isolamento, revisões, importação, preservação da cópia, câmbio, separação de licenças e protecção dos direitos no banco. Os testes de banco são omitidos se `DATABASE_URL` não estiver definida; o CI do repositório disponibiliza PostgreSQL e aplica as migrações antes de os executar.
