# Login + sincronização (Fase 1) — configuração do Supabase

O jogo continua **jogável sem login**. Quem entrar (com **código por e-mail**)
passa a ter **ofensiva, medalhas, XP e progresso salvos na nuvem** e
**sincronizados entre aparelhos**. Sem senha, sem Google Cloud.

É uma ativação única, gratuita — parecida com a do Cloudflare.

---

## Passo 1 — Criar o projeto Supabase (grátis)
1. Crie conta em https://supabase.com (pode entrar com o GitHub).
2. **New project** → dê um nome (ex.: `cottage-color`), escolha uma **senha do
   banco** (guarde-a) e a região mais próxima (ex.: *South America (São Paulo)*).
3. Espere ~2 min o projeto ficar pronto.

## Passo 2 — Criar a tabela
1. No projeto: **SQL Editor → New query**.
2. Cole o conteúdo do arquivo **`supabase/schema.sql`** (deste repositório).
3. **Run**. Deve dizer "Success".

## Passo 3 — Fazer o e-mail enviar o CÓDIGO
O login usa um **código de 6 dígitos**. Precisamos garantir que o e-mail mostre
esse código:
1. **Authentication → Emails → Templates → "Magic Link"** (ou "OTP").
2. No corpo do e-mail, garanta que exista o código **`{{ .Token }}`** (pode
   deixar algo como: *"Seu código: **{{ .Token }}**"*). Salve.

> Sem isso, o e-mail manda só um link e não o código de 6 dígitos.

## Passo 4 — (Opcional) apontar a URL do jogo
**Authentication → URL Configuration → Site URL:**
`https://fernandoapparecido-oss.github.io/cottage-color-game/`

## Passo 5 — Me mandar as duas chaves
Em **Project Settings → API**, copie:
- **Project URL** (ex.: `https://abcd1234.supabase.co`)
- **anon public** key (uma chave longa; a *anon*, **não** a *service_role*)

Me mande as duas. Eu ligo o jogo nelas e republico — aí o botão **Entrar** passa
a funcionar para todo mundo.

---

## Notas
- A chave **anon** é **pública de propósito** (pode ir no site). Quem protege os
  dados são as *políticas* do Passo 2 (cada um só acessa o que é seu).
- **Nunca** me mande a chave **service_role** nem a senha do banco.
- O e-mail grátis do Supabase tem **limite baixo** (poucos por hora) e pode cair
  no spam — ótimo para testar. Para lançar de verdade, dá para configurar um
  serviço de e-mail próprio depois.
- Só sincronizamos **gamificação + progresso** nesta fase. Os **quadros
  importados** (mais pesados) ficam para a Fase 2.
