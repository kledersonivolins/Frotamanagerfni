# Carrinho abandonado (FORJA) — lembrete por WhatsApp após 20 minutos

Quando um cliente **cadastrado**, com **consentimento de WhatsApp**, deixa itens no
carrinho e não compra, 20 minutos depois ele recebe **uma** mensagem pelo WhatsApp
(Evolution API) avisando do carrinho e levando de volta ao site.

```
Site (FORJA)  ──cart-sync──►  Supabase (ca_carts)
                                   ▲
              pg_cron (1 min) ─► cart-recover ──► Evolution API ──► WhatsApp do cliente
                                                         │
Cliente responde "SAIR" ──► webhook ──► cart-optout ◄────┘
```

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| `site/index.html` | Loja FORJA com campo de WhatsApp + consentimento no cadastro e rastreio do carrinho |
| `supabase/migrations/` | Tabelas `ca_carts` e `ca_optout` (RLS fechada) + agendador a cada minuto |
| `supabase/functions/cart-sync` | Recebe o carrinho do site (só origens permitidas) |
| `supabase/functions/cart-recover` | Roda a cada minuto e envia o lembrete |
| `supabase/functions/cart-optout` | Webhook da Evolution: cliente respondeu SAIR |
| `tests/` | `node tests/logic.test.mjs` e `node tests/site.test.mjs` |

## Regras implementadas

- Só rastreia quem se cadastrou, informou WhatsApp **e marcou o checkbox** de consentimento.
- **Um lembrete por carrinho** e no máximo **um por telefone a cada 24 h**.
- **Horário de silêncio** 21h–8h (Fortaleza): carrinhos que vencem à noite saem de manhã.
- Pedido finalizado, carrinho esvaziado, logout ou "Excluir meus dados" cancelam o lembrete.
- Cliente que responde `SAIR` / `PARAR` / `STOP` entra na lista de opt-out e nunca mais recebe.
- Falha no envio: até 3 tentativas, com espera crescente.
- O navegador **não** lê nada do banco (RLS sem policies); só as funções acessam.

## Publicar (passo a passo)

> Recomendo um projeto Supabase **separado** do `oficinafni`/FrotaManager (produção de outra operação).

1. **Migration** — aplique `supabase/migrations/20261010000000_carrinho_abandonado.sql`
   (`supabase db push` ou SQL Editor). Ela cria as tabelas e o agendamento.
2. **Segredos do agendador (Vault)** — no SQL Editor, com os seus valores:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'ca_project_url');
   select vault.create_secret('<um-segredo-longo-aleatorio>', 'ca_cron_secret');
   ```
3. **Secrets das funções** — `supabase secrets set ...`:
   | Secret | Valor |
   |---|---|
   | `CRON_SECRET` | o mesmo de `ca_cron_secret` |
   | `ALLOWED_ORIGINS` | URL do site, ex.: `https://forja-loja.netlify.app` |
   | `SITE_URL` | link que vai na mensagem |
   | `EVOLUTION_URL` | URL pública da sua Evolution (via Traefik) |
   | `EVOLUTION_INSTANCE` | nome da instância do número do Brasilvita/loja |
   | `EVOLUTION_APIKEY` | apikey da instância |
   | `OPTOUT_TOKEN` | token aleatório para o webhook de SAIR |
   | `STORE_NAME`, `RECOVERY_COUPON` | opcionais (nome na mensagem; cupom oferecido) |
   | `MINUTES`, `QUIET_START`, `QUIET_END` | opcionais (padrão 20, 21, 8) |
4. **Funções** — `supabase functions deploy cart-sync cart-recover cart-optout`
   (a pasta `supabase/` daqui já tem o `config.toml` sem exigir JWT).
5. **Webhook da Evolution** — na instância, evento `MESSAGES_UPSERT` apontando para
   `https://<ref>.supabase.co/functions/v1/cart-optout?token=<OPTOUT_TOKEN>`.
6. **Site** — em `site/index.html`, preencha
   `const RECOVERY={endpoint:'https://<ref>.supabase.co/functions/v1/cart-sync'}` e publique
   (a pasta `site/` inteira; hoje é um `index.html` único).

Chaves e tokens **não** ficam em arquivo nem em commit — só em secrets/Vault.

## Testar ponta a ponta

1. Cadastre-se no site com seu WhatsApp e marque o consentimento, adicione um item e não compre.
2. Em `ca_carts` aparece a linha `status = 'active'`.
3. Para não esperar: `update ca_carts set last_activity_at = now() - interval '25 minutes';`
   (fora do horário de silêncio) e aguarde o próximo minuto → `status = 'reminded'` e a mensagem chega.
4. Responda `SAIR` e confira `ca_optout`.

## Atenção (LGPD e WhatsApp)

- **Consentimento:** a mensagem é marketing/transacional automática. O checkbox no cadastro e o `SAIR`
  são o que sustenta isso; mantenha o texto do consentimento claro e guarde a política de privacidade em dia.
- **Evolution API não é oficial:** envio automático em volume pode levar ao **bloqueio do número**. Por isso
  há limite por telefone, horário de silêncio e opt-out. Para escalar, considere a API oficial (Cloud API/templates).
- **Anti-abuso:** o endpoint público aceita carrinhos de qualquer cadastro; o limite de 1 lembrete/24 h por
  telefone e o opt-out reduzem o risco de alguém usar o número de terceiros. Se virar problema, o próximo passo é
  confirmar o número por código (OTP) antes de ativar os lembretes.
- O site da FORJA é uma demonstração: contas e senha ficam no `localStorage` do navegador. Para produção,
  use autenticação real (ex.: Supabase Auth) — o carrinho abandonado funciona igual, só trocando a origem do usuário.
