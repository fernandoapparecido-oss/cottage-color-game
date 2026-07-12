# Mini-servidor de busca (Cottage Color)

Este é o **proxy** que deixa o jogo buscar ilustrações no **Pixabay**. Ele é
minúsculo, gratuito e roda no **Cloudflare Workers** (plano grátis: 100.000
requisições por dia — muito mais do que precisamos).

Por que ele existe: o Pixabay não deixa o navegador chamar a API direto (CORS)
e a chave da API não pode ficar exposta no site. O Worker resolve os dois.

---

## Passo 1 — Pegar a chave do Pixabay (grátis)

1. Crie uma conta em https://pixabay.com/ (ou entre, se já tiver).
2. Abra https://pixabay.com/api/docs/ — logado, sua **API key** aparece no
   começo da página, num quadro. Copie essa chave.

## Passo 2 — Criar o Worker no Cloudflare

1. Crie uma conta grátis em https://dash.cloudflare.com/sign-up
2. No painel, vá em **Workers & Pages → Create → Create Worker**.
3. Dê um nome (ex.: `cottage-color-proxy`) e clique **Deploy** (ele cria um
   Worker de exemplo — vamos substituir o código no próximo passo).
4. Clique **Edit code**. Apague tudo que estiver no editor e **cole o conteúdo
   do arquivo `cottage-color-proxy.js`** (deste repositório). Clique **Deploy**.

## Passo 3 — Guardar a chave como Secret

1. Ainda no Worker, vá em **Settings → Variables and Secrets** (ou
   *Variables → Add variable*).
2. Adicione uma variável do tipo **Secret**:
   - **Name:** `PIXABAY_KEY`
   - **Value:** a chave que você copiou no Passo 1
3. Salve/**Deploy**.

## Passo 4 — Me mandar a URL

O Worker fica num endereço tipo:

```
https://cottage-color-proxy.SEU-USUARIO.workers.dev
```

Copie essa URL e me mande. Eu ligo o jogo nela e republico — aí a busca
funciona para todo mundo, sem você precisar fazer mais nada.

---

### Testar (opcional)
Abrir no navegador `https://.../search?q=gato` deve devolver um JSON com uma
lista de imagens. `https://.../img?u=<url de imagem do pixabay>` devolve a
imagem. Se `/search` reclamar de `PIXABAY_KEY`, o Secret do Passo 3 não foi
salvo.

### Segurança
- A chave do Pixabay fica **só no Worker** (Secret), nunca no site.
- O `/img` só aceita imagens hospedadas no `pixabay.com` — não é um proxy
  aberto.
