# Auditoria técnica e preparação comercial — Kianda
Data: 4 de Novembro de 2026 · RH, Integra e Valora

## Conclusão

O produto tem os três módulos operacionais, licenças independentes, isolamento por empresa e testes de cálculos e permissões. Foram confirmadas falhas de navegação, recuperação de rede, autorização de sessões e conservação de rascunhos. Esta entrega corrige os problemas descritos abaixo.

É adequado preparar demonstrações e uma campanha piloto com acompanhamento. Antes de uma campanha ampla com clientes pagos, é necessário fechar os pontos comerciais e operacionais indicados na secção final. Esta auditoria é uma revisão de código e testes dos percursos descritos; a confirmação final de publicação consta do CI da PR.

## Problemas confirmados e correcções

| Prioridade | Constatação | Efeito e correcção |
| --- | --- | --- |
| Alta | Uma sessão assinada mantinha o perfil antigo e não consultava a desactivação do utilizador em cada pedido. | A API passou a verificar o utilizador, a empresa, o estado e o perfil actual antes de autorizar operações. Testes exercitam uma sessão já emitida depois de desactivar a conta ou reduzir o perfil. |
| Alta | O Valora podia abrir outra análise depois de falhar a gravação, substituindo o rascunho local. Conflitos/expiração nem sempre mantinham a indicação de dados pendentes. | Conserva o estado por gravar e impede troca, criação, duplicação, arquivo e importação até conseguir gravar. Recarregar uma versão ou terminar sessão descartando dados exige decisão explícita no ecrã. |
| Alta | O registo aceitava pedidos da API sem aceitação dos termos; a obrigatoriedade existia só no formulário. | A API exige `acceptTerms: true` e regista aceitação, versão do texto e data na auditoria. Os testes que criam empresas passam a aceitar explicitamente. |
| Alta/moderada | A análise de dependências de produção encontrou 5 ocorrências altas e 8 moderadas, nos caminhos transitivos de construção/publicação (glob, minimatch e undici). | Versões corrigidas fixadas por overrides e lockfile. A repetição de `pnpm audit --prod` assinalou zero vulnerabilidades conhecidas em 04/11/2026. O build Cloudflare e CI validam a compatibilidade das alterações. |
| Média | O Valora decidia a exportação pelos direitos carregados ao abrir a página. | Confirma a licença actual junto da API e exige a gravação do rascunho em cada exportação. Uma suspensão ou activação posterior é reconhecida. |
| Média | Registo, login e recuperação não tinham acesso claro à página principal; numa PWA não existe necessariamente a barra do navegador. | Navegação visível para a página inicial nesses ecrãs e no acesso por convite/recuperação; no registo longo permanece visível ao deslocar a página. |
| Média | Falhas de rede podiam deixar formulários em “A criar…”, “A entrar…” ou “A enviar…”. | Pedido JSON comum com timeout, recuperação de controlo e mensagem de erro; aplicado também às mutações RH. Uma resposta HTML inválida não é tratada como login bem-sucedido. |
| Média | O destino `voltar` do login aceitava uma variante com barra invertida que o navegador podia interpretar como outro domínio. | Só aceita rotas da própria plataforma; teste cobre destinos externos, barras invertidas e caracteres de controlo. |
| Média | O simulador aparecia no espaço do colaborador, apesar de existir como ferramenta própria de Salários. | Mantém-se autónomo em Salários para proprietário, RH, salários e finanças; retirado do espaço do colaborador. Acrescentado “Voltar” na área RH sem terminar a sessão. |
| Baixa | No cálculo inverso do simulador, activar contrato em USD sem câmbio não apresentava a validação necessária. | Exige câmbio quando USD está activo, nos dois sentidos da simulação. |
| Baixa | Registo, login, recuperação, emails e termos continuavam a apresentar apenas RH ou dois módulos. | Identificação comum Kianda, com RH/Integra/Valora. Os termos incluem o âmbito do Valora e conservam a indicação de versão de trabalho sujeita a revisão. |

## Pontos confirmados por código e testes

- RH continua por faixas fixas, sem extra de 3.000 Kz por colaborador.
- Integra e Valora têm licenças, quotas e utilizadores separados do RH.
- Avaliação de sete dias e exportação paga por módulo; PDF exclusivo para clientes Integra e Excel reservado ao proprietário do produto configurado.
- Isolamento de dados por empresa com RLS, auditoria e controlo de revisão.
- Integra conserva versões aprovadas imutáveis e acesso por projecto.
- Motor Integra verifica fecho do Balanço e coerência da caixa nos oito sectores e cenários dos testes.
- Valora tem testes de demonstrações, margens, Balanço, avaliação e exportação; campos monetários e datas seguem os formatos partilhados.
- A regra Cloudflare foi confirmada como aplicada no registo da publicação anterior. A cópia diária de 04/11/2026 terminou com sucesso.
- As bibliotecas de PDF/Word/Excel são servidas pela aplicação.
- Os protótipos de referência e os preços aprovados são preservados. Não houve migração de dados nesta entrega.

## Validação desta entrega

- Core: 315 testes aprovados.
- Web: 174 testes aprovados, incluindo novos casos de rede, redireccionamento, menu e conservação do rascunho.
- TypeScript da web e API: aprovado.
- API local: sem PostgreSQL disponível; integração completa é executada no CI com PostgreSQL real. O caso público de quiosque também necessita da base e falha neste ambiente sem DATABASE_URL; não se declara aprovação local da bateria completa.
- E2E do CI: inclui abandonar registo incompleto no computador e telemóvel sem criar conta; erro de rede no login; simulador em Salários e regresso à lista sem logout; câmbio obrigatório em USD.
- Auditoria de dependências de produção: zero avisos conhecidos na repetição.
- A publicação requer sucesso dos testes com PostgreSQL, E2E e build Cloudflare; smoke público verifica também as novas ligações de regresso.
- Não foram criadas contas ou feitos pagamentos na base de produção para esta auditoria.

## O que falta para publicidade

| Momento | Acção | Evidência ou motivo |
| --- | --- | --- |
| Antes de aceitar clientes pagos em escala | Finalizar a identificação comercial, termos e privacidade, contactos do suporte e regras de cancelamento/reembolso. | Os termos ainda dizem “versão de trabalho”; acrescentar o Valora e registar aceitação não equivale à revisão final. |
| Antes de uma campanha autónoma de registos | Confirmar envio de email real: boas-vindas, recuperação, convites e avisos. | A última publicação consultada não mostrou Resend nas chaves enviadas pelo workflow. É necessário testar entrega real com um endereço do dono, incluindo spam e recuperação. Não foram enviados emails nesta auditoria. |
| Antes de prometer pagamentos automáticos | Validar contratação/configuração da ProxyPay e emissão de documentos de cobrança. | A transferência manual pode ser usada se o processo de conferência e activação for acompanhado. Não anunciar Multicaixa automático sem o circuito completo confirmado. |
| Antes da campanha ampla | Executar um ensaio acompanhado: conta nova, sete dias, pagamento, activação do módulo correcto, documento exportado, pedido de suporte e cancelamento. | O CI valida a aplicação em ambiente isolado; o circuito comercial real depende da configuração do dono e dos fornecedores. |
| Antes de confiar exclusivamente no backup | Ensaiar restauro completo numa segunda base e definir cópia/recuperação dos ficheiros R2. | O workflow actual cifra, decifra e lista o arquivo PostgreSQL; não repõe uma base completa, nem inclui ficheiros do R2. |
| Na preparação da campanha | Criar guia curto e demonstração com os nomes e ecrãs actuais; definir responsável e prazo de resposta no suporte. | Evita que o cliente chegue a menus antigos ou fique sem assistência durante o teste. |
| Na comunicação do produto | Descrever os limites reais de cada módulo. | O Integra analisa projecções do próprio projecto. O Valora não deve ser anunciado como leitor automático universal de balancetes PDF de qualquer ERP: essa evolução ainda precisa de implementação e validação. |
| Para medir a campanha e a descoberta orgânica | Confirmar Search Console, sitemap e medição de visitas/registos/activação respeitando a política de privacidade. | Metadados e sitemap existentes não comprovam indexação nem medem a conversão de uma campanha. |

Recomendação: começar por demonstrações e um piloto acompanhado; avançar para publicidade ampla depois de validar recuperação de acesso, circuito comercial e textos finais. Integrações opcionais e Excel exclusivo do proprietário não devem atrasar a demonstração das funcionalidades já disponíveis.

## Referências técnicas

- Autorização: `apps/api/src/plugins/tenant.ts`.
- Registo e aceitação: `apps/api/src/routes/auth.ts`, `packages/core/src/licensing.ts`.
- Navegação: `apps/web/components/auth-navigation.tsx`, `back-button.tsx`, `lib/navigation.ts`.
- Rede: `apps/web/lib/json-request.ts`, `lib/client.ts`.
- Valora: `apps/web/valuation/adapter.js`, `save-guard.test.ts`.
- Dependências: `pnpm-workspace.yaml`, `pnpm-lock.yaml`; avisos GHSA-5j98-mcp5-4vw2, GHSA-4w7w-5xrc-9h26, GHSA-g3hv-75wg-m249 e GHSA-3g3m-2fjr-6pw4.
- Operação e limites conhecidos: `docs/DEPLOY.md`, `docs/HANDOFF.md`, `docs/MODULOS-LICENCAS.md`.

