# Conta comum, módulos e tabela comercial

Uma conta e empresa partilhadas, no mesmo repositório e base de dados. `/registo` permite escolher RH, Modelagem ou ambos e o plano/ciclo de cada um. Os módulos escolhidos têm o período experimental existente de 7 dias. Os não escolhidos continuam visíveis, sem acesso. `/modulos`, `/licenca` e Definições apresentam o catálogo comum. O layout, CSS global e protótipo financeiro originais são preservados; os controlos acrescentados respondem à contratação e aos acessos.

## Recursos Humanos

Faixas fixas por colaboradores activos. Semestral −10%, anual −15%, à vista, arredondados ao kwanza. Fonte no código: `DEFAULT_TIERS`, `CYCLES` e `cyclePrice` em `packages/core/src/licensing.ts`.

<!-- tabela-rh: gerada a partir do código; o teste packages/core/test/docs-coherence.test.ts falha se divergir -->
| Chave | Colaboradores activos | Mensal (Kz) | Semestral, à vista (Kz) | Anual, à vista (Kz) |
| --- | --- | ---: | ---: | ---: |
| t1 | 1–100 | 29.900 | 161.460 | 304.980 |
| t2 | 101–250 | 49.900 | 269.460 | 508.980 |
| t3 | 251–500 | 69.900 | 377.460 | 712.980 |
| t4 | 501–1.000 | 89.900 | 485.460 | 916.980 |
| t5 | Mais de 1.000 | 99.999 | 539.995 | 1.019.990 |

A primeira faixa admite zero colaboradores durante a configuração. O RH não vende colaboradores extra: ao ultrapassar o limite, a empresa passa para a faixa seguinte. O antigo adicional de 3.000 Kz por colaborador foi descontinuado; pedidos antigos pendentes foram cancelados com auditoria, pagamentos confirmados mantêm montantes e facturas, e valores legados de `extra_seats` não aumentam limites. Contratos `custom` anteriores continuam reconhecidos e pedidos já emitidos mantêm os valores gravados. O preço do RH nunca é usado para a Modelagem.

## Modelagem Financeira (Integra)

Licenciada por projectos activos simultâneos, independente do efectivo do RH. Fonte no código: `MODELING_PLANS`, `MODELING_EXTRA_USER_MONTHLY_MINOR` e `modelingPlanPrice` em `packages/core/src/modeling-policy.ts`.

<!-- tabela-integra: gerada a partir do código; o teste packages/core/test/docs-coherence.test.ts falha se divergir -->
| Chave | Plano | Projectos activos | Sectores | Mensal (Kz) | Semestral, à vista (Kz) | Anual, à vista (Kz) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| pme | PME | 2 | 2 | 69.000 | 372.600 | 703.800 |
| corporate | Corporate | 5 | 4 | 120.000 | 648.000 | 1.224.000 |
| enterprise10 | Grandes Empresas (Até 10) | 10 | 8 | 200.000 | 1.080.000 | 2.040.000 |
| unlimited | Grandes Empresas (Ilimitado) | Ilimitados | 8 | 300.000 | 1.620.000 | 3.060.000 |

- Sectores: PME = sector principal confirmado no registo + 1 à escolha; Corporate = principal + 3; Grandes Empresas = os 8. A actividade da empresa sugere o principal; o cliente confirma-o no campo próprio da Modelagem, e ele não muda quando o RH altera a actividade.
- O plano Ilimitado tem opção mensal (a antiga proibição foi removida na migração `0036`).
- Todos os planos incluem **5 utilizadores**, contando o proprietário. Extras: **35.000 Kz por mês e utilizador**, em todos os meses do ciclo, sem desconto. Exemplo: Corporate semestral com 2 extras = 648.000 + 2 × 35.000 × 6 = **1.068.000 Kz**.
- Projectos, sectores e utilizadores são limites distintos. Projectos ilimitados não significam utilizadores ilimitados; o efectivo RH não altera os lugares da Modelagem.
- Arquivar um projecto liberta a vaga e conserva os registos; restaurar exige vaga e acesso ao sector.

## Análise e Avaliação (Kianda Valora)

Terceiro módulo, com licença própria: demonstrações financeiras por PGC Angola (classe 6 proveitos, classe 7 custos), orçamento, tesouraria, controlo orçamental com dados reais mensais (introduzidos ou importados de CSV/Excel), rácios, análise de gestão e avaliação (DCF, múltiplos, activos reais e síntese), com relatórios em PDF, Word e Excel.

Licenciado por **análises activas** (uma análise = uma entidade analisada: a própria empresa, uma participada ou um alvo), como o Integra, sem relação com o efectivo do RH e sem sectores. Fonte no código: `VALUATION_PLANS`, `VALUATION_EXTRA_USER_MONTHLY_MINOR` e `valuationPlanPrice` em `packages/core/src/valuation.ts`.

<!-- tabela-valora: gerada a partir do código; o teste packages/core/test/docs-coherence.test.ts falha se divergir -->
| Chave | Plano | Análises activas | Mensal (Kz) | Semestral, à vista (Kz) | Anual, à vista (Kz) |
| --- | --- | ---: | ---: | ---: | ---: |
| essencial | Essencial | 10 | 32.900 | 177.660 | 335.580 |
| pme | PME | 20 | 52.900 | 285.660 | 539.580 |
| corporate | Corporate | 30 | 72.900 | 393.660 | 743.580 |
| enterprise40 | Grandes Empresas (Até 40) | 40 | 92.900 | 501.660 | 947.580 |
| unlimited | Grandes Empresas (Ilimitado) | Ilimitadas | 129.900 | 701.460 | 1.324.980 |

- Todos os planos incluem **5 utilizadores**, contando o proprietário. Extras do Valora: **10.000 Kz por mês e utilizador**, em todos os meses do ciclo, sem desconto.
- Avaliação de 7 dias com as quotas do plano escolhido no registo (por omissão, Essencial mensal). Uma empresa já registada subscreve em **Módulos e licenças → Valora** (pedido de pagamento); a licença só é activada pela confirmação do pagamento — a empresa não concede licenças a si própria (a base de dados recusa escrita em `company_modules` ao papel da aplicação). A plataforma pode ainda ajustar limites em **Plataforma Kianda → Valora**, nunca abaixo do uso.
- Arquivar uma análise liberta a vaga e conserva os dados; restaurar exige vaga. Um plano nunca é aceite abaixo do uso actual (análises activas e utilizadores com acesso).
- Os dados de cada análise ficam no servidor, por empresa (RLS), com controlo de revisão; nada da análise fica no armazenamento do navegador. Bibliotecas de PDF e Word servidas pela própria origem, sem CDN.
- Com o RH na mesma conta, uma análise marcada como «própria empresa» traz os custos com o pessoal (conta 72) dos processamentos fechados.

## Período experimental e exportações

- **7 dias de calendário**, incluindo o dia do registo, pela hora de Luanda, para cada módulo escolhido no registo.
- Durante a avaliação trabalha-se dentro das quotas do plano escolhido (criar, editar, calcular, importar, simular), mas os documentos gerados ficam **só em pré-visualização**: `canExportDocuments` só permite exportar em `active` e `past_due`; a API responde **402 `exportacao_requer_subscricao`** (não depende de esconder botões).
- Depois de um período pago há 7 dias de tolerância (`past_due`), com escrita e exportação; depois, modo de consulta (ver dados e pré-visualizações, sem alterar nem exportar).
- O pagamento antecipado activa logo as exportações e conserva os dias experimentais restantes no início do período pago. Sem cartão e sem cobrança automática.
- Pagar o RH não desbloqueia exportações da Modelagem ou do Valora, e vice-versa: cada módulo tem a sua licença. Anexos carregados pelo cliente, facturas/recibos da licença e a portabilidade JSON não estão sujeitos a este bloqueio.

## Pagamento e autorização

- `POST /v1/billing/requests`: `kind=subscription` para RH; `kind=modeling_subscription` com `planKey`, `cycle`, `extraUsers` e `sectors` para Modelagem. O servidor calcula preço, datas, quota e sectores. Montantes enviados pelo cliente não são utilizados.
- Cada pedido identifica um módulo. Confirmação manual ou Multicaixa activa apenas esse módulo, numa transacção com auditoria. Pedidos RH e Modelagem podem coexistir. Criar/substituir um pedido não altera direitos.
- A redução de projectos, lugares ou sectores exige resolver primeiro o uso excedente. A verificação repete-se na confirmação do pagamento. O contador global de pedidos é atómico entre empresas.
- O catálogo mostra ambos os módulos, mas a API exige a respectiva licença. Modelagem exige também membro autorizado. Proprietários atribuem `editor`/`viewer` na licença; a gestão de contas e convites é comum. Convites por ficha de colaborador exigem RH activo.
- Clientes de Modelagem descarregam apenas PDF. XLSX continua exclusivo do ID exacto configurado do proprietário do produto, em conjunto com estatuto de administrador. Um plano ilimitado não altera a política de formatos.
- RH → Modelagem continua opcional, por cópia identificada e imutável. A subscrição de ambos não importa dados automaticamente.

## Dados existentes e publicação

Migrações aditivas `0032` e `0033`: identificadores de plano/ciclo, quota ilimitada representada por `NULL`, sector principal e sectores escolhidos; o pedido guarda a cópia do contrato a activar. RLS e a proibição de alteração de licenças pelo papel da empresa mantêm-se. Licenças antigas de Modelagem conservam os oito sectores e limites contratados, incluindo o acesso interno de acompanhamento; o registo novo selecciona explicitamente os sectores do plano.

Testes verificam todos os preços publicados (incluindo a coerência destas tabelas com o código), sectores e quotas independentes, ilimitado mensal, extras, pagamentos por módulo, URLs directas/codificadas, isolamento entre empresas, concorrência, PDF e preservação do protótipo. Os testes de integração correm com PostgreSQL no CI.
