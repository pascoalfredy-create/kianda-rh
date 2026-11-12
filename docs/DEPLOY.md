# Publicação — Cloudflare + Neon (PostgreSQL)

Igual ao Enterprise: **cada push para `main` verifica, testa e publica automaticamente** (GitHub Actions → Cloudflare Workers).

```
Navegador ──► rh.seudominio.com  (Worker kianda-web, Next.js via OpenNext)
                    │ service binding (interno, sem endereço público)
                    ▼
              Worker kianda-api (Hono) ──► Hyperdrive ──► PostgreSQL (Neon, Frankfurt)
```

- A API **não tem endereço público**: só o Worker web lhe chega.
- A sessão é um cookie httpOnly no domínio da web.
- O Hyperdrive mantém as ligações à base de dados abertas (menos latência a partir de Luanda) e trata do TLS.

> **Porquê Neon e não Supabase?** O plano gratuito do Supabase permite só 2 projectos activos e **pausa o projecto após 7 dias sem uso** — o site ficaria em baixo até alguém o reactivar à mão. O Neon gratuito permite 100 projectos e, quando está inactivo, suspende a computação e **retoma sozinho em poucas centenas de milissegundos** no pedido seguinte. O Kianda usa PostgreSQL puro: mudar de fornecedor é só mudar a connection string.

## Configuração única (≈ 20 minutos)

### 1. Neon — base de dados

1. Em [neon.com](https://neon.com) → criar conta (pode entrar com o GitHub) → **New project** → nome `kianda-rh`, Postgres 17, região **AWS Europe Central 1 (Frankfurt)** — a mais próxima de Angola.
2. No painel do projecto → **Connect** → desligue **Connection pooling** (o Hyperdrive já faz o pooling) → copie a connection string. Fica assim:
   `postgresql://neondb_owner:<PASSWORD>@ep-xxxx-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`

O certificado do Neon é público: não é preciso o secret `KIANDA_DATABASE_CA_CERT`.

### 2. Cloudflare — Hyperdrive

1. Painel Cloudflare → **Storage & Databases → Hyperdrive → Create configuration**.
2. Nome `kianda-db`, cole a connection string do passo 1.2 → **Create**. (Em alternativa, o painel tem uma ligação directa ao Neon.)
3. Copie o **ID** da configuração (secret `KIANDA_HYPERDRIVE_ID`).

### 3. Cloudflare — token da API

Pode reutilizar o token do Enterprise **se** tiver estas permissões; senão crie um novo em **My Profile → API Tokens → Create Token → Edit Cloudflare Workers** e acrescente:

| Âmbito | Permissão |
| --- | --- |
| Account · Workers Scripts | Edit |
| Account · Hyperdrive | Edit |
| Zone (o seu domínio) · Workers Routes | Edit |
| Zone (o seu domínio) · DNS | Edit (necessário para o custom domain) |
| Account · Workers R2 Storage | Edit (opcional — ficheiros anexados no R2; sem ela ficam na base de dados) |

### 4. GitHub — secrets e variáveis

Repositório `kianda-rh` → **Settings → Secrets and variables → Actions**.

**Secrets**

| Nome | Valor |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | token do passo 3 |
| `CLOUDFLARE_ACCOUNT_ID` | o mesmo do Enterprise (painel Cloudflare → barra lateral) |
| `KIANDA_DATABASE_URL` | connection string do passo 1.2 (usada só para migrações) |
| `KIANDA_DATABASE_CA_CERT` | não necessário com o Neon (só para fornecedores com CA privada, ex.: Supabase) |
| `KIANDA_HYPERDRIVE_ID` | ID do passo 2.3 |
| `KIANDA_JWT_SECRET` | segredo aleatório com 48+ caracteres (ex.: `openssl rand -base64 48`) |
| `KIANDA_SEED_OWNER_PASSWORD` | palavra-passe do utilizador demo (só se activar os dados de demonstração) |

**Variables**

| Nome | Valor |
| --- | --- |
| `KIANDA_HOSTNAME` | subdomínio, ex.: `rh.seudominio.com` (o domínio tem de estar no Cloudflare) |
| `KIANDA_DEPLOY` | `true` — liga a publicação automática |
| `KIANDA_SEED_DEMO` | `true` para carregar a empresa de demonstração (pode desligar depois) |

### 5. Publicar

**Actions → CI e publicação → Run workflow** (ou qualquer push para `main`). No fim, o passo *Verificar* chama `https://<KIANDA_HOSTNAME>/api/health`.

O custom domain cria automaticamente o registo DNS e o certificado HTTPS do subdomínio.

## Depois de publicado

- **Regra de limite de tentativas — activa desde 02/11/2026, aplicada pela publicação** (`scripts/cf-ratelimit.mjs`, idempotente, exige «Zone WAF Rules · Edit» no token). Referência para a criar à mão, se for preciso: Cloudflare → domínio → **Security → Security rules** (painel antigo: Security → WAF) → **Rate limiting rules** → Create rule. O plano **gratuito** permite **uma** regra, contagem por IP, janela fixa de **10 s**, acção Block durante 10 s. Configuração: 5 pedidos / 10 s por IP → Block, com a expressão (todas as rotas de autenticação numa só regra):
  `(http.host eq "kianda.yelaperformance.com" and http.request.method eq "POST" and http.request.uri.path in {"/api/v1/auth/login" "/api/v1/auth/login-pin" "/api/v1/auth/login/2fa" "/api/v1/auth/register" "/api/v1/auth/forgot"})`
  O limite interno da API (por instância e só tentativas falhadas) mantém-se; esta regra é global. Num plano pago pode alargar-se a janela para 1 minuto (ex.: 10 pedidos/min).
- **Logs**: Workers & Pages → `kianda-web` / `kianda-api` → **Logs** (observabilidade activa).
- **Neon gratuito**: 0,5 GB e 100 horas de computação por mês por projecto — com suspensão automática quando parado, chega para dezenas de empresas pequenas. Ao crescer, o plano Launch não tem mensalidade mínima (paga-se o uso).
- **Plano**: o plano gratuito dos Workers chega para começar. Com uso real (dezenas de utilizadores em simultâneo), o Workers Paid (5 USD/mês) aumenta o tempo de CPU por pedido e o número de pedidos.

## Desenvolvimento local

Continua igual: `pnpm dev` (API Node em :4000, web em :3000) com PostgreSQL local. Para testar o runtime Cloudflare localmente:

```bash
pnpm --filter @kianda/web cf:build
npx wrangler dev -c apps/web/wrangler.jsonc -c apps/api/wrangler.jsonc   # web + API ligados por service binding
```


## Administradores da plataforma (consola Kianda)

Em **Settings → Secrets and variables → Actions → Variables**, crie `KIANDA_PLATFORM_ADMINS` com os emails (separados por vírgula) de quem administra a plataforma. Cada publicação sincroniza a lista. O email tem de corresponder a um utilizador que já exista (por exemplo, o proprietário de uma empresa criada em `/registo`); ao entrar, aparece o menu **Plataforma Kianda**.

### Acompanhamento do Integra em produção

A Modelagem está em `https://<domínio-principal>/modelagem`, com a mesma sessão. A publicação autorizada inclui `modeling:review`: quando há exactamente um email em `KIANDA_PLATFORM_ADMINS`, uma única conta activa de proprietário correspondente e estatuto de administrador já registado, activa uma licença interna apenas na empresa dessa conta, com 20 projectos e cinco utilizadores, sem facturação. É uma capacidade técnica para acompanhar o desenvolvimento, não uma tabela comercial para clientes. O proprietário é admitido como editor; nenhum outro participante é adicionado automaticamente.

O script preserva qualquer licença já existente, incluindo suspensões e quotas, e não reactiva participações desactivadas ou ultrapassa cinco acessos. Uma configuração ambígua fica sem alterações e é indicada no log. As restantes empresas continuam a precisar de adesão explícita. O Excel continua a exigir `KIANDA_MODELING_OWNER_USER_ID` e estatuto de administrador: esta activação não o concede por inferência.

A análise de balancetes usa a migração aditiva `0031_integra_historical_analysis`, aplicada pelo workflow antes da API. Não exige novos secrets ou alterações de subscrição. Ver [formato, limitações e utilização](./MODELAGEM-HISTORICO.md).

## Integrações (entrega 17) — activar quando houver contrato

Cada integração liga-se sozinha quando o secret existir no GitHub (o deploy seguinte envia-o para o Worker da API). Sem secret, fica desligada e o Kianda usa o fluxo manual. O estado aparece na consola **Plataforma Kianda → Integrações**.

| Integração | Secret (GitHub → Secrets) | Variáveis (GitHub → Variables) |
| --- | --- | --- |
| Multicaixa — ProxyPay | `KIANDA_PROXYPAY_API_KEY` | `KIANDA_PROXYPAY_ENV` = `sandbox` ou `production`; `KIANDA_PROXYPAY_ENTITY` = n.º da entidade (5 dígitos) |
| Email — Resend | `KIANDA_RESEND_API_KEY` | `KIANDA_MAIL_FROM` = `Kianda RH <noreply@seudominio>` (domínio verificado no Resend) |
| Facturação AGT — Cegid Vendus | `KIANDA_VENDUS_API_KEY` | `KIANDA_VENDUS_MODE` = `tests` (por omissão) ou `normal` |

**ProxyPay (Multicaixa):** contrato com a TimeBoxed e um banco angolano; a ProxyPay fornece a chave da API (sandbox e produção) e a entidade. Peça para activarem o webhook com o endereço `https://<KIANDA_HOSTNAME>/api/v1/public/gateway/proxypay` (assinatura `X-Signature`, HMAC-SHA256 com a chave). Mesmo sem webhook, o Worker lê os pagamentos a cada 30 minutos. Em sandbox, a consola tem o botão "Simular pagamento".

**Resend:** criar conta, verificar o domínio de envio (registos DNS na Cloudflare) e gerar a chave. Os emails também ficam registados na consola (enviados, não enviados, falhados).

Se o remetente estiver em `notificacoes.yelaperformance.com`, o job **Configurar DNS do email** verifica o DMARC desse subdomínio e do domínio principal. Se ambos estiverem livres, cria o TXT `_dmarc.notificacoes.yelaperformance.com` com `v=DMARC1; p=none`. O token de publicação precisa de leitura da zona e edição DNS. Confirme os registos públicos e o resultado DMARC numa nova mensagem de teste.

**Cegid Vendus:** a factura tem de ser emitida em software certificado pela AGT (Decreto Presidencial n.º 71/25 — facturação electrónica; hoje obrigatória só para fornecedores do Estado, regime geral a partir de Janeiro). Até lá a factura pode continuar a ser emitida fora e o n.º registado ao confirmar o pagamento. Conta Vendus Angola → APPS → API → chave. Comece em `tests`; na consola defina o imposto da licença de software (taxa normal, ou isenção com código e fundamento legal — decisão do dono, que é o contabilista), o id do meio de pagamento e, se quiser, a emissão automática. Pagamentos sem factura aparecem na consola com "Emitir factura".

**Tarefas agendadas do Worker da API:** `*/30 * * * *` (sincronização Multicaixa) e `0 7 * * *` (avisos de licença às 08:00 de Luanda).

## Cópias de segurança (entrega 18)

O workflow **Cópia de segurança** (`.github/workflows/backup.yml`) está agendado para as 02:17 de Luanda e pode correr manualmente em **Actions → Cópia de segurança → Run workflow**. Guarda o `pg_dump` da base Neon e a cópia dos anexos, cifrados com AES-256 antes de saírem do runner, por 30 dias. O repositório é público. Os artefactos estão sujeitos às permissões de leitura do GitHub e a confidencialidade dos dados depende da cifra e do segredo da frase. Uma alteração ao próprio workflow em `main` corre o ensaio de restauro sem publicar um novo artefacto. A cópia complementa o restauro de histórico do Neon.

- **Secret obrigatório:** `KIANDA_BACKUP_PASSPHRASE` — frase longa (20+ caracteres), gerada e guardada fora do GitHub (gestor de palavras-passe). Sem ela não há cópia (nunca se guardam dados de clientes sem cifra). **Perder a frase = perder as cópias.**
- **Verificação da cópia SQL.** O workflow decifra o ficheiro com a frase gravada e lê o inventário com `pg_restore --list`. Exige pelo menos 20 tabelas com dados, incluindo `companies`, `users`, `subscriptions` e `financial_models`.
- **Restauro real em cada cópia:** o workflow reconstrói a cópia numa base Postgres 18 isolada, consulta os registos essenciais e confirma que o papel `kianda_app` só lê utilizadores da empresa seleccionada. Erros de restauro ou de isolamento falham a execução.
- **Ficheiros no R2.** Com os secrets `KIANDA_R2_ACCESS_KEY_ID` e `KIANDA_R2_SECRET_ACCESS_KEY` (chave S3 só de leitura) e o `CLOUDFLARE_ACCOUNT_ID`, o workflow copia o bucket, cifra o arquivo e junta-o ao artefacto. Depois de decifrar e extrair, compara os ficheiros com a cópia de origem e os SHA-256 dos anexos com os registos da base restaurada. Também valida os anexos guardados directamente na base. A execução falha se existirem referências ao R2 sem a chave de leitura ou se faltar um anexo registado.

Para recuperar o serviço, faça o ensaio numa base vazia e num bucket privado de recuperação. Use o SQL e o R2 da mesma execução.

1. Confira os ficheiros cifrados com o manifesto SHA-256 e decifre-os num ambiente isolado. Use `gpg --decrypt kianda-AAAA-MM-DD_HHMM.dump.gpg > kianda.dump` para o SQL e extraia o `.tgz.gpg` dos anexos num directório temporário.
2. Crie o papel `kianda_app` na base vazia, restaure com `pg_restore --no-owner --no-privileges -d "$RESTORE_DATABASE_URL" kianda.dump` e reponha as permissões de aplicação das migrações. O dump preserva as políticas RLS, mas omite os `GRANT`. Um ramo Neon criado a partir de produção já contém as tabelas e os dados dessa produção.
3. Copie os ficheiros do directório `r2/` para o bucket de recuperação, mantendo as chaves `empresa/ficheiro`. Ligue uma instância de ensaio da aplicação à base e ao bucket restaurados. Confirme o acesso de uma empresa aos seus anexos e o isolamento entre empresas. Registe a hora da cópia e o tempo do ensaio antes de decidir a reposição da produção.

## Domínio próprio

`KIANDA_HOSTNAME` aceita vários domínios separados por vírgula; o **primeiro é o principal** (ligações nos emails e verificações do deploy). Para mudar de domínio sem cortes: (1) adicionar a zona do domínio novo à conta Cloudflare; (2) `KIANDA_HOSTNAME=rh.dominio-novo.ao,kianda.yelaperformance.com`; (3) avisar o ProxyPay do novo endereço do webhook; (4) mais tarde, retirar o antigo da lista.

## Segurança por empresa (RLS)

A migração `0019` cria o papel `kianda_app` (sem login, sem `BYPASSRLS`) e as políticas `empresa`. Os pedidos de uma empresa correm em `withTenant` (transacção com `SET LOCAL ROLE kianda_app` e `app.company_id`). O utilizador da ligação (Hyperdrive) continua a ser o dono das tabelas — não é preciso mudar a ligação. Tarefas de sistema, registo, login, webhook e consola da plataforma correm sem papel restrito.

## Ficheiros anexados (entrega 20)

Cópias de documentos, justificativos de ausências e comprovativos de despesas. Em cada publicação o CI tenta usar o bucket R2 `kianda-files` (cria-o se não existir):

- **Com R2** (recomendado): active o R2 na conta Cloudflare (**R2 → Enable**, sem custo até 10 GB) e dê ao token a permissão *Workers R2 Storage: Edit*. O passo "Armazenamento de ficheiros" do CI mostra `R2: bucket kianda-files ligado`.
- **Sem R2**: o CI mostra um aviso e os ficheiros ficam na base de dados (Neon), com limite de 250 MB por empresa. Os dois modos convivem: quando o R2 for activado, os ficheiros novos vão para lá e os antigos continuam legíveis.

A consola da plataforma mostra o modo em uso, o número de ficheiros e o espaço ocupado. A cópia de segurança diária da base de dados inclui os ficheiros guardados na base de dados, mas não o R2 (o R2 tem a sua própria durabilidade).
A cópia independente do R2 é verificada no mesmo workflow quando as credenciais de leitura estão configuradas.

## Disponibilidade pública

O workflow **Disponibilidade pública** verifica a página inicial, o login e a resposta de saúde da API no domínio principal duas vezes por hora. Consulte o estado e os tempos das respostas em Actions.

A recuperação de palavra-passe por email (`/recuperar`) só funciona com o Resend configurado (secção Integrações); sem ele, a página indica que se peça a ligação ao RH.

## Alertas de erro da API

Quando a API devolve um erro interno (500), os administradores da plataforma (tabela `platform_admins`) recebem um email «Kianda · erro interno em MÉTODO /rota». Cada erro (tipo + rota sem identificadores) gera no máximo um email por hora, com um teto global de 10 alertas por hora. O email não leva dados de clientes: rota, tipo, a primeira linha da mensagem e a assinatura para procurar nos registos do Worker. Requer o Resend configurado (secção Integrações); sem ele, os alertas ficam só registados em `outbound_emails`.
