# 🏡 Cottage Color — Planejamento por etapas

Mapa do caminho, do protótipo até o app publicado. Cada etapa tem um
**entregável testável** — só avançamos quando a anterior funciona no celular.

Legenda: ✅ feito · 🟡 em andamento · 🔜 próxima · ⬜ planejada

> **Onde estamos:** Etapas 0, 1, 2, 4 e **5A concluídas** + o **motor vetorial
> (SVG)** de brinde (Etapa 2B). O jogo está **publicado e compartilhável** em
> https://fernandoapparecido-oss.github.io/cottage-color-game/ (repositório
> dedicado, PWA instalável, offline). Agora começando a **Etapa 3 (busca de
> imagens por tema)**; o polimento (Etapa 7) segue em paralelo.
>
> **Plano atual: Etapa 3 — buscar imagens por tema na web.** O app **nativo**
> (Etapa 5B, com AdMob) fica como **futuro**, para quando formos monetizar.
> Faltam ainda: Etapa 3 (busca na web), Etapa 6 (anúncios).

---

## Etapa 0 — Protótipo jogável ✅
- Colorir por número, paleta com contadores, salvar progresso, confete.
- Destaque da cor com **rachura** (agora **responsiva ao zoom** — regiões
  pequenas mostram as listras).
- Quadros de exemplo.

---

## Etapa 1 — Motor pronto para escala (dezenas–centenas de regiões) ✅
- Formas "assadas" em **mapa de regiões disjuntas** e **vetorizadas** de volta.
- Paleta que rola e centraliza a cor ativa; botão **🎯 achar próxima região**.
- Números dimensionados por região e **escondidos até dar zoom** (visão limpa).

---

## Etapa 2 — Pipeline de imagem → quadro (no celular) ✅
Transformar uma imagem enviada num quadro jogável, offline, sem servidor.

- ✅ Tela de **Enviar imagem** com pré-visualização e controles **Cores** e
  **Detalhe** (Menos/Médio/Mais). Quadros gerados ficam **salvos**.
- ✅ **Motor de line-art (`fromLineArt`)** — o mesmo do acervo. Evolução grande
  desde o plano original:
  - **Detecção de traço robusta:** cume (ridge) para traço fino colorido +
    termo de **linha grossa** (moldura/contornos bold viram traço contínuo,
    não região). Traço **fino e delicado** (erodido), em carvão suave.
  - **Encaixe exato entre regiões** (vetorizador de aresta compartilhada):
    fim das **frestas brancas** e do **vazamento de cor**.
  - **Des-franja:** faixas finas e pontinhos grudados no contorno são
    **absorvidos** pela vizinha de cor parecida (protege flor/ovelha/sol).
  - **Camada-base** rasterizada para não sobrar branco entre regiões.
- ✅ O **Enviar imagem** agora usa esse motor (mesma qualidade do acervo).

> **Melhor com** ilustrações 2D de cores chapadas (desenhos por IA, cartoon,
> line-art). **Foto real** muito detalhada continua sendo o caso difícil (por
> isso a dica na tela). Caminho ideal para foto real: Etapa 3 + curadoria.

---

## Etapa 2B — Motor vetorial (SVG) ✅  *(bônus, não estava no plano)*
Partir de **vetor** dá qualidade muito superior à de rasterizar.

- ✅ **Importar SVG no app** (colar código ou enviar `.svg`): cada forma vira
  região, com **encaixe exato** e contorno contínuo.
- ✅ **Degradê preservado:** cada região guarda a arte original; ao pintar, o
  **degradê é revelado** (reveal-on-paint). Jogável por número, resultado rico.
- ✅ **Faixas de degradê:** um céu em degradê vira algumas faixas de cor, então
  a paleta fica rica e o degradê aparece mesmo antes de completar.

**Entregável (feito):** enviar um SVG e jogá-lo com degradê.

---

## Etapa 3 — Busca por tema na web 🟡 (EM ANDAMENTO — frente atual)
Buscar imagens por assunto e rodá-las pelo pipeline.

- ✅ **Fonte escolhida: Pixabay**, filtrando **`image_type=illustration`** — o
  estilo (2D chapado) que o motor processa bem, ao contrário de fotos.
- ✅ **Proxy pronto** (`/worker/cottage-color-proxy.js`, Cloudflare Worker):
  esconde a chave da API, adiciona **CORS** e repassa a imagem escolhida sem
  "sujar" o canvas. *(Pixabay não tem CORS e proíbe hotlink → o proxy é
  necessário.)*
- ✅ **Tela "Buscar na web"** no app: campo de tema → grade de resultados →
  escolher → pré-visualização do quadro → **Jogar**. Usa o mesmo motor
  `fromLineArt` do acervo. **Testado de ponta a ponta** (mock) sem erros.
- 🔜 **Ativação única do usuário:** criar chave grátis no Pixabay + subir o
  Worker no Cloudflare (passo-a-passo em `/worker/README.md`) e me passar a URL
  do Worker, que eu fixo no app (`WEB_SEARCH_PROXY`) e republico.

**Entregável:** buscar um tema, escolher uma imagem e jogá-la. *(Falta só a
ativação do proxy pelo usuário.)*

---

## Etapa 4 — Biblioteca e conteúdo (acervo) ✅
- ✅ **Fluxo de curadoria** (Gemini → traçador → pré-assado em `curated.js`).
- ✅ **6 quadros** no acervo: 4 de PNG (Vilarejo, Cozinha, Safári, Casa na
  Árvore) + 2 de SVG (Lago ao Pôr do Sol, Montanhas ao Entardecer).
- ✅ **Categorias** no menu (Minhas imagens, Paisagem, Casa, Animais, Clássicos).
- ⬜ "Imagem do dia", coleções, "continuar de onde parou" em destaque na home.

---

## Etapa 5 — Plataforma: Web (agora) → Nativo (futuro)

### Etapa 5A — Web compartilhável / PWA ✅ (concluída)
Deixar o jogo **rodando e compartilhável na web** — sem loja, sem instalar.
- ✅ **PWA:** `manifest.webmanifest` + **ícone** (192/512/maskable) + metas
  Apple/Android → **instalável** ("Adicionar à tela inicial").
- ✅ **Service worker** (`sw.js`): carrega **offline** e abre rápido
  (testado: registra, controla e funciona sem rede).
- ✅ Compartilhar a obra (cartão + baixar/segurar para salvar).
- ✅ **Hospedado** com **link estável**, em **repositório dedicado**
  (`cottage-color-game`), publicado via **GitHub Pages** (workflow
  `.github/workflows/pages.yml` republica a cada envio ao `main`):
  **https://fernandoapparecido-oss.github.io/cottage-color-game/**

**Entregável (feito):** um link que abre o jogo no celular, instala na tela
inicial, joga offline e compartilha a pintura — basta enviar a URL. *(a versão
Artifact segue como "jogar na hora" durante o desenvolvimento.)*

### Etapa 5B — App nativo (Capacitor) ⬜ (futuro — quando monetizar)
**Decisão Web × App (avaliada):** para um jogo casual que vive de **anúncio**,
o destino é **nativo**, porque:
- **AdMob (intersticial + premiado/rewarded) só funciona nativo** — a Etapa 6
  praticamente exige isso; ads de navegador pagam pouco e não têm rewarded.
- **Loja (Play Store)** = descoberta (grande no Brasil/Android) + credibilidade.
- **Push** (retenção), **compartilhamento/galeria nativos**, **IAP** ("remover
  anúncios").

**Não é ou/ou:** o **Capacitor empacota o mesmo código web** (~100% reuso), e
a versão web continua como "jogar na hora" (funil). Por isso **web agora,
nativo depois**. Começar pelo **Android** (mais fácil/barato; iOS pede Mac).

**Entregável:** o app instalado, com AdMob ligado, publicado na Play Store.

---

## Etapa 6 — Monetização (anúncios) ⬜
Ligar os ganchos `TODO(ads)`: intersticial entre quadros, **premiado** para
dicas, banner opcional. Consentimento (LGPD/GDPR) e limite de frequência.

---

## Etapa 7 — Polimento e lançamento 🟡 (em andamento)
Detalhes de experiência que fazem o jogo parecer "de verdade".

- ✅ Rachura **responsiva ao zoom**; sem borda grossa na seleção.
- ✅ **Tela de conclusão**: interface some, obra aparece limpa, confete.
- ✅ **Recomeçar** um quadro (↺); **instruções** de uso nos dois imports.
- ✅ **Compartilhar a obra** — tela que monta um **cartão** (obra + moldura +
  selo "🏡 Cottage Color" + título), com **antes/depois** opcional, **baixar**
  e "segurar para salvar". **Funciona perfeitamente** na versão hospedada.
- ✅ **Recomeçar (↺)** funcionando na versão hospedada.
- ⬜ Som/vibração ao pintar; micro-animação ao concluir uma cor.
- ⬜ **Desfazer**; avanço de cor mais visível.
- ⬜ Tutorial de primeira vez; página nas lojas, métricas, soft launch.
- 🚫 **Arrastar o dedo para pintar** — *descartado* (não combina com este
  estilo de jogo de precisão).

### 🐞 Bugs conhecidos
- *(nenhum em aberto)* — o **Recomeçar (↺)** voltou a funcionar na versão
  hospedada (o problema era o `confirm()` bloqueado na sandbox do artifact,
  que não existe no site publicado).

### Próximo passo
Etapa 5A **fechada** e polimento em bom estado (Recomeçar + Compartilhar OK).
Foco agora na **Etapa 3 (busca de imagens por tema)** — ver notas de
arquitetura na seção da Etapa 3 acima (fonte de imagens, CORS/backend,
qualidade). Polimento restante (desfazer, som/vibração) fica em paralelo.

---

## Decisões no caminho
| Quando | Decisão | Recomendação |
|---|---|---|
| Etapa 3 | Fonte de imagens | **Openverse/Pixabay** (licença livre). |
| Etapa 3/5 | Onde fica o backend/chaves | Backend mínimo só p/ busca (Etapa 3). |
| Etapa 5 | Empacotar | **Capacitor** (reusa o app web inteiro). |
| Etapa 6 | Rede de anúncios | **AdMob**. |
