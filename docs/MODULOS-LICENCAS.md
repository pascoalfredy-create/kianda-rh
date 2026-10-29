# Conta comum, módulos e tabela comercial

Uma conta e empresa partilhadas, no mesmo repositório e base de dados. `/registo` permite escolher RH, Modelagem ou ambos e o plano/ciclo de cada um. Os módulos escolhidos têm o período experimental existente de 7 dias. Os não escolhidos continuam visíveis, sem acesso. `/modulos`, `/licenca` e Definições apresentam o catálogo comum. O layout, CSS global e protótipo financeiro originais são preservados; os controlos acrescentados respondem à contratação e aos acessos.

## Recursos Humanos

| Colaboradores activos | Mensal (Kz) | Semestral, à vista (Kz) | Anual, à vista (Kz) |
| --- | ---: | ---: | ---: |
| 1–100 | 99.999 | 540.000 | 959.990 |
| 101–250 | 200.000 | 1.080.000 | 1.920.000 |
| 251–500 | 280.000 | 1.512.000 | 2.688.000 |
| 501–1.000 | 380.000 | 2.052.000 | 3.648.000 |
| Mais de 1.000 | 450.000 | 2.430.000 | 4.320.000 |

A primeira faixa usa os montantes comerciais indicados, incluindo o arredondamento semestral para 540.000 Kz. Contratos `custom` anteriores continuam reconhecidos e os pedidos já emitidos mantêm os valores gravados. O preço de RH nunca é utilizado para Modelagem. O RH não vende colaboradores extra: o limite corresponde apenas à faixa contratada e, quando necessário, a empresa muda para a faixa seguinte. O adicional de 3.000 Kz foi descontinuado. Pedidos antigos de extras ainda pendentes são cancelados com auditoria; pagamentos já confirmados mantêm os montantes e as facturas no histórico. Novas referências e confirmações desses extras são bloqueadas, incluindo pelo gateway. Valores legados de `extra_seats` não aumentam os limites actuais.

## Modelagem Financeira

| Plano | Projectos simultâneos | Sectores | Mensal (Kz) | Semestral, à vista (Kz) | Anual, à vista (Kz) |
| --- | ---: | ---: | ---: | ---: | ---: |
| PME | 2 | 2 | 300.000 | 1.620.000 | 2.880.000 |
| Corporate | 5 | 4 | 600.000 | 3.240.000 | 5.760.000 |
| Grandes Empresas (Até 10) | 10 | 8 | 1.200.000 | 6.480.000 | 11.520.000 |
| Grandes Empresas (Ilimitado) | Ilimitados | 8 | Não disponível | 8.100.000 | 14.400.000 |

PME: sector principal confirmado no registo + 1 à escolha. Corporate: principal + 3 à escolha. Grandes Empresas: os 8 sectores financeiros. A actividade geral da empresa sugere o principal no registo; o cliente confirma o campo próprio da Modelagem. O principal fica guardado e não muda quando o RH altera a actividade da empresa.

Os cinco utilizadores incluídos contam o proprietário da empresa. Extras a 35.000 Kz/mês por utilizador, durante todos os meses do ciclo e sem desconto nos extras. Exemplo: Corporate semestral com 2 extras = 3.240.000 + 2 × 35.000 × 6 = 3.660.000 Kz. Projectos ilimitados não significam utilizadores ilimitados. O efectivo RH não altera os lugares de Modelagem.

## Pagamento e autorização

- `POST /v1/billing/requests`: `kind=subscription` para RH; `kind=modeling_subscription` com `planKey`, `cycle`, `extraUsers` e `sectors` para Modelagem. O servidor calcula preço, datas, quota e sectores. Montantes enviados pelo cliente não são utilizados.
- Cada pedido identifica um módulo. Confirmação manual ou Multicaixa activa apenas esse módulo, numa transacção com auditoria. Pedidos RH e Modelagem podem coexistir. Criar/substituir um pedido não altera direitos.
- A redução de projectos, lugares ou sectores exige resolver primeiro o uso excedente. A verificação repete-se na confirmação do pagamento. O contador global de pedidos é atómico entre empresas.
- O catálogo mostra ambos os módulos, mas a API exige a respectiva licença. Modelagem exige também membro autorizado. Proprietários atribuem `editor`/`viewer` na licença; a gestão de contas e convites é comum. Convites por ficha de colaborador exigem RH activo.
- Clientes de Modelagem descarregam apenas PDF. XLSX continua exclusivo do ID exacto configurado do proprietário do produto, em conjunto com estatuto de administrador. Um plano ilimitado não altera a política de formatos.
- RH → Modelagem continua opcional, por cópia identificada e imutável. A subscrição de ambos não importa dados automaticamente.

## Dados existentes e publicação

Migrações aditivas `0032` e `0033`: identificadores de plano/ciclo, quota ilimitada representada por `NULL`, sector principal e sectores escolhidos; o pedido guarda a cópia do contrato a activar. RLS e a proibição de alteração de licenças pelo papel da empresa mantêm-se. Licenças antigas de Modelagem conservam os oito sectores e limites contratados, incluindo o acesso interno de acompanhamento; o registo novo selecciona explicitamente os sectores do plano.

Testes verificam todos os preços publicados, sectores e quotas independentes, rejeição do ilimitado mensal, extras, pagamentos por módulo, URLs directas/codificadas, isolamento entre empresas, concorrência, PDF e preservação do protótipo. Os testes de integração correm com PostgreSQL no CI.
