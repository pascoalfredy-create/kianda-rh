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

- **Regra de limite de tentativas** (recomendado): Cloudflare → o seu domínio → **Security → WAF → Rate limiting rules** → URI path `equals /api/v1/auth/login`, 10 pedidos / 1 minuto por IP → Block. O limite interno da API é por instância; esta regra é global.
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

## Integrações (entrega 17) — activar quando houver contrato

Cada integração liga-se sozinha quando o secret existir no GitHub (o deploy seguinte envia-o para o Worker da API). Sem secret, fica desligada e o Kianda usa o fluxo manual. O estado aparece na consola **Plataforma Kianda → Integrações**.

| Integração | Secret (GitHub → Secrets) | Variáveis (GitHub → Variables) |
| --- | --- | --- |
| Multicaixa — ProxyPay | `KIANDA_PROXYPAY_API_KEY` | `KIANDA_PROXYPAY_ENV` = `sandbox` ou `production`; `KIANDA_PROXYPAY_ENTITY` = n.º da entidade (5 dígitos) |
| Email — Resend | `KIANDA_RESEND_API_KEY` | `KIANDA_MAIL_FROM` = `Kianda RH <noreply@seudominio>` (domínio verificado no Resend) |
| Facturação AGT — Cegid Vendus | `KIANDA_VENDUS_API_KEY` | `KIANDA_VENDUS_MODE` = `tests` (por omissão) ou `normal` |

**ProxyPay (Multicaixa):** contrato com a TimeBoxed e um banco angolano; a ProxyPay fornece a chave da API (sandbox e produção) e a entidade. Peça para activarem o webhook com o endereço `https://<KIANDA_HOSTNAME>/api/v1/public/gateway/proxypay` (assinatura `X-Signature`, HMAC-SHA256 com a chave). Mesmo sem webhook, o Worker lê os pagamentos a cada 30 minutos. Em sandbox, a consola tem o botão "Simular pagamento".

**Resend:** criar conta, verificar o domínio de envio (registos DNS na Cloudflare) e gerar a chave. Os emails também ficam registados na consola (enviados, não enviados, falhados).

**Cegid Vendus:** a factura tem de ser emitida em software certificado pela AGT (Decreto Presidencial n.º 71/25 — facturação electrónica; hoje obrigatória só para fornecedores do Estado, regime geral a partir de Janeiro). Até lá a factura pode continuar a ser emitida fora e o n.º registado ao confirmar o pagamento. Conta Vendus Angola → APPS → API → chave. Comece em `tests`; na consola defina o imposto da licença de software (taxa normal, ou isenção com código e fundamento legal — decisão do dono, que é o contabilista), o id do meio de pagamento e, se quiser, a emissão automática. Pagamentos sem factura aparecem na consola com "Emitir factura".

**Tarefas agendadas do Worker da API:** `*/30 * * * *` (sincronização Multicaixa) e `0 7 * * *` (avisos de licença às 08:00 de Luanda).
