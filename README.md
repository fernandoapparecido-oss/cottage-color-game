# 🏡 Cottage Color — protótipo web

Jogo de **colorir por número** (estilo *Cottage Color* / *Happy Color*), feito
como protótipo web sem dependências nem etapa de build. É o **primeiro
entregável**: a *engine jogável*. Os recursos de upload de imagem, busca por
tema e anúncios vêm nas próximas fases (ver Roadmap).

## Como rodar

Basta abrir `index.html` num navegador. Para testar no celular com o toque
funcionando bem, sirva a pasta e acesse pelo IP da máquina:

```bash
cd game
python3 -m http.server 8000
# no celular (mesma rede): http://SEU_IP:8000
```

## Como jogar

1. Na tela inicial, escolha um quadro pronto — ou toque em **Enviar imagem**
   para transformar uma **foto sua** num quadro (ajuste **Cores** e **Detalhe**,
   veja a prévia e toque em **Jogar**). Os quadros criados ficam salvos.
2. Toque numa cor da paleta (embaixo). As regiões daquele número ficam em
   destaque; as demais ficam esmaecidas.
3. Toque nas regiões para preenchê-las. Tocar numa região de outro número
   **troca automaticamente** para a cor correta (ajuda o jogador).
4. **Pinça** para dar zoom, **arraste** para mover, **toque duplo** para
   resetar a visão. O 🎯 mostra a próxima região da cor atual; o 💡 preenche
   uma região aleatória (é o gancho do *rewarded ad*).
5. Ao completar, sai confete 🎉 e o progresso é salvo automaticamente.

## Estrutura

```
game/
├── index.html            # shell da UI (menu, jogo, overlay de vitória)
├── build.js              # empacota tudo em cottage-color.html (arquivo único)
├── cottage-color.html    # build de arquivo único (o que abre no celular)
└── src/
    ├── styles.css        # visual mobile-first, cores cottagecore
    ├── levels.js         # DADOS dos quadros (formas + paletas) — declarativo
    ├── boards.js         # vetorizador: mapa de regiões disjuntas → contornos SVG
    ├── pipeline.js       # foto → quadro (quantiza, segmenta, funde, vetoriza)
    └── game.js           # engine: render, seleção, upload, pan/zoom, save
```

Fluxo dos dados: `levels.js` descreve cada quadro como **formas empilhadas**;
`boards.js` transforma isso num **mapa de regiões que não se sobrepõem** e traça
o contorno de cada uma de volta para vetor. Esse mapa de regiões disjuntas é
exatamente o que o *pipeline de imagem* (Etapa 2) vai **gerar** a partir de uma
foto — alimentando a mesma engine.

Depois de editar qualquer arquivo em `src/`, rode `node build.js` para
regenerar o `cottage-color.html`.

## Onde os anúncios entram

Os ganchos já estão marcados com `TODO(ads)` em `src/game.js`:

- **Intersticial** entre quadros → função `win()`.
- **Rewarded video** para a dica → função `useHint()`.

Numa versão nativa (React Native / Capacitor), esses pontos chamam o AdMob.

## Roadmap (próximas fases)

1. **Pipeline imagem → quadro** — upload de foto, quantização de cor,
   segmentação em regiões e numeração, gerando o mesmo formato de `levels.js`.
2. **Busca por tema** — buscar imagens por assunto usando APIs com licença
   livre (Unsplash / Pixabay / Openverse) e rodá-las pelo pipeline.
3. **Empacotar como app** — Capacitor ou React Native para publicar nas lojas.
4. **Monetização** — AdMob (intersticial + rewarded) nos ganchos acima.
