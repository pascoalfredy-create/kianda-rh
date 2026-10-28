# Análise histórica do Integra

Usa o mesmo repositório, PostgreSQL e sessão do Kianda. O RH é independente. O HTML/CSS de referência permanece intacto; os controlos existentes do protótipo passam a usar a API. Os ajustes de espaço pedidos ficam isolados em `apps/web/modeling/space.css`: mapas extensos ocupam a largura disponível e os campos de balancetes têm altura útil, sem alterar a navegação ou o RH.

## Utilização

1. Abra `/modelagem`, seleccione/crie um projecto e entre em **Análise de demonstrações**.
2. Carregue o balancete N e, opcionalmente, N−1 em **PDF com texto, CSV ou TXT**, ou cole os dados. Indique exercícios, moeda e a percentagem dos empréstimos de curto prazo. Depois de importar PDF, confira as contas e os montantes extraídos no formulário.
3. Prima **Analisar**. A análise e a origem ficam guardadas neste projecto. Alterações ainda não analisadas permanecem apenas na memória da página, com aviso ao sair.
4. Consulte os separadores existentes: Balanço, DR, fluxo de caixa estimado e rácios.
5. Em **Relatórios**, seleccione o relatório de análise económico-financeira e descarregue o PDF.
6. **Usar como base de um modelo** cria outro projecto, sujeito à quota contratada. O projecto de origem fica intacto.

O botão **Exemplo** apenas preenche o formulário. A origem só é gravada ao premir **Analisar**. Sem projecto ou sem balancetes, não são criados dados financeiros fictícios. Utilizadores de consulta não importam nem criam modelos.

## Formato e cálculo

- CSV/TXT em UTF-8 ou Windows-1252, com `;`, vírgula ou tabulação; aspas e separadores dentro das designações são suportados. Cada balancete admite 250 000 caracteres e até 5 000 contas. A selecção de ficheiros tem limite de 250 000 bytes.
- PDF até **10 MB e 80 páginas**, com texto seleccionável, cabeçalhos `Conta`/`Designação` e saldos finais em todas as páginas. Aceita `Saldo Devedor`/`Saldo Credor`, `Saldo` com sinal ou `Saldo` e natureza `D/C`. Lê várias páginas por coordenadas e confronta contas-mãe e totais de classe. Débitos/créditos de movimentos não são confundidos com saldos finais. Exporte valores em unidades.
- O PDF é lido **localmente no navegador**, por um worker PDF.js servido pelo Kianda, sem CDN e sem envio do documento a serviços externos. Apenas o texto estruturado, conferido e aprovado com **Analisar**, segue para a API; o PDF original não é arquivado. Importações falhadas preservam os dados anteriores. Mudar de vista ou projecto cancela a leitura; alterações ao texto durante a leitura não são substituídas. Há um limite de 45 segundos por leitura.
- PDF digitalizados sem texto precisam de OCR antes de importar. Documentos protegidos exigem uma cópia sem palavra-passe. Cabeçalhos ambíguos, tabelas sem PGC, formatos não reconhecidos e páginas mistas sem texto são recusados explicitamente; não são aceites importações parciais. Extractos bancários de movimentos, sem balancete PGC completo, não geram Balanço/DR completos.
- Colunas `Conta`, `Designação` e `Saldo Devedor`/`Saldo Credor`, ou `Saldo` com sinal. São aceites `Débito`/`Crédito` apenas como totais acumulados que incluam a abertura; movimentos isolados do período não são saldos finais. Sem cabeçalho: conta, designação, saldo; ou conta, designação, devedor, credor.
- Montantes processados em cêntimos. Valores inválidos, contas repetidas ou sem classificação e comparativos de anos não consecutivos são recusados. O comparativo inválido nunca é ignorado.
- Contas-mãe e filhas não se somam duas vezes. O total da mãe tem de corresponder à soma das subcontas fornecidas. Códigos compactos e com pontos são normalizados para detectar repetições.
- Custos na classe 7, proveitos na classe 6 e imposto na 87. Exige balancete antes do apuramento, sem saldos de resultados intermédios 82–86/88. Saldos devedor/credor de clientes, fornecedores e outros terceiros são separados, incluindo adiantamentos.
- O fluxo indirecto é **estimado**. Sem diário não se identificam de forma autónoma alienações, reavaliações, câmbio ou operações sem caixa. A parcela residual de capital próprio não é apresentada como dividendo confirmado. A reconciliação é algébrica.
- Rácios com denominador nulo/negativo ficam indisponíveis quando a interpretação não é válida. Saldos médios usados com comparativo; prazos sem IVA; limiares indicativos a ajustar ao sector.

Mapa de contas revisto contra o PGC do Decreto n.º 82/01, disponibilizado no [Conselho Nacional de Normalização Contabilística](https://cnnca.minfin.gov.ao/legislacao/sector-empresarial) e na [reprodução do Diário da República](https://files.lex.ao/conselho-de-ministros/2001/decreto-n-o-82-01-de-16-de-novembro/download/decreto-n-o-82-01-de-16-de-novembro_conselho-de-ministros_lex-ao.pdf). A análise não substitui as demonstrações assinadas pelo contabilista.

## Origem de um modelo e versões

A abertura mantém o capital próprio histórico. Outros activos correntes são agregados aos clientes e outros passivos correntes aos fornecedores, com notas no pressuposto `historicalBasis`. O crescimento de receitas/preços inicia em zero. Inflação, imposto, vida útil, juros, prazos, taxa de desconto e investimento futuro exigem revisão: não são factos inferidos do balancete. Investimentos financeiros ou provisões de longo prazo não são convertidos automaticamente para a abertura simplificada.

As importações e os modelos derivados são auditados, com hash da origem e revisão. Gravações concorrentes exigem a revisão actual. A tabela `financial_historical_inputs` tem RLS por empresa e verifica a empresa do projecto. Integra a exportação/eliminação da empresa.

A aprovação congela também os balancetes, a análise e o oitavo relatório no conteúdo imutável da versão. Alterações posteriores não mudam esse PDF. Versões antigas sem histórico mantêm os sete relatórios originais; não recebem balancetes retroactivamente. Aprovar uma versão não representa deliberação do comité.

Clientes descarregam PDF. O Excel de resultados conserva a verificação do ID exclusivo do proprietário da plataforma **e** estatuto de administrador; continua sem fórmulas de recálculo. A entrega não concede novos acessos, preços ou direitos de exportação.

## API

| Método / recurso | Efeito |
| --- | --- |
| `GET /v1/modeling/models/:id/history` | Consulta origem e análise da revisão actual |
| `PUT /v1/modeling/models/:id/history` | `{ revision, input }`; valida e grava a origem, avançando a revisão quando muda |
| `POST /v1/modeling/models/:id/history/to-model` | `{ revision }`; cria cópia de avaliação, com controlo de quota |
| `GET /v1/modeling/models/:id/reports/analise` | PDF histórico da revisão actual, mesmo com projecção incompleta |
| `GET /v1/modeling/models/:id/reports/analise?version=…` | PDF congelado, ou erro explícito se a versão não contém histórico |

Campos de `input`: `empresa`, `anos: ["2024", "2025"]`, `N1` (texto opcional), `N` (texto obrigatório), `pctCP` (0–100), `moeda` (`Kz`, `USD`, `EUR`). O download inclui `x-source-revision` e `x-source-history-hash`.
