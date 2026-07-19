# Login + sincronização (Fase 1) — configuração do Supabase

O jogo continua **jogável sem login**. Quem entrar (com um **link enviado por
e-mail**) passa a ter **ofensiva, medalhas, XP e progresso salvos na nuvem** e
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

## Passo 3 — Apontar a URL do jogo (importante)
O login usa o **link de acesso** que o Supabase já manda por e-mail (o e-mail
padrão "Your sign-in link"). **Não precisa editar template nenhum.** Mas o link
precisa saber para onde voltar:

1. **Authentication → URL Configuration**.
2. Em **Site URL**, coloque:
   `https://fernandoapparecido-oss.github.io/cottage-color-game/`
3. Em **Redirect URLs**, adicione a mesma URL:
   `https://fernandoapparecido-oss.github.io/cottage-color-game/`
4. Salve.

> Sem isso, ao tocar no link do e-mail a pessoa pode cair numa página de erro em
> vez de voltar pro jogo.

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
