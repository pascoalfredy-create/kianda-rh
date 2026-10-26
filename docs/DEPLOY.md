# Publicação — Cloudflare + Supabase

Igual ao Enterprise: **cada push para `main` verifica, testa e publica automaticamente** (GitHub Actions → Cloudflare Workers).

```
Navegador ──► rh.seudominio.com  (Worker kianda-web, Next.js via OpenNext)
                    │ service binding (interno, sem endereço público)
                    ▼
              Worker kianda-api (Hono) ──► Hyperdrive ──► PostgreSQL (Supabase)
```

- A API **não tem endereço público**: só o Worker web lhe chega.
- A sessão é um cookie httpOnly no domínio da web.
- O Hyperdrive mantém as ligações ao Supabase abertas (menos latência a partir de Luanda) e trata do TLS.

## Configuração única (≈ 20 minutos)

### 1. Supabase — base de dados

1. Em [supabase.com](https://supabase.com) → **New project** → nome `kianda-rh`, região **Frankfurt (eu-central-1)** ou **London (eu-west-2)** (as mais próximas de Angola). Guarde a palavra-passe da base de dados.
2. **Project Settings → Database → Connection string → URI**, modo **Session pooler** (porta 5432). Fica assim:
   `postgresql://postgres.<ref>:<PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
3. (Recomendado) **Project Settings → Database → SSL Configuration → Download certificate**. O conteúdo do ficheiro `.crt` vai para o secret `KIANDA_DATABASE_CA_CERT` (verificação TLS completa nas migrações).

> Projecto separado do usado pelo Enterprise: dados de RH isolados, cópias de segurança e limites próprios.

### 2. Cloudflare — Hyperdrive

1. Painel Cloudflare → **Storage & Databases → Hyperdrive → Create configuration**.
2. Nome `kianda-db`, cole a connection string do passo 1.2 → **Create**.
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
| `KIANDA_DATABASE_CA_CERT` | conteúdo do certificado do passo 1.3 (opcional; sem ele, acrescente `?sslmode=no-verify` ao URL) |
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
- **Plano**: o plano gratuito dos Workers chega para começar. Com uso real (dezenas de utilizadores em simultâneo), o Workers Paid (5 USD/mês) aumenta o tempo de CPU por pedido e o número de pedidos.

## Desenvolvimento local

Continua igual: `pnpm dev` (API Node em :4000, web em :3000) com PostgreSQL local. Para testar o runtime Cloudflare localmente:

```bash
pnpm --filter @kianda/web cf:build
npx wrangler dev -c apps/web/wrangler.jsonc -c apps/api/wrangler.jsonc   # web + API ligados por service binding
```
