// Bake the acervo boards with the clean line-art pipeline into src/curated.js.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const GAME = '/home/user/project-context-poc/game';
const boardsJs = fs.readFileSync(path.join(GAME, 'src/boards.js'), 'utf8');
const pipelineJs = fs.readFileSync(path.join(GAME, 'src/pipeline.js'), 'utf8');
const GRID_LONG = 1600;

const JOBS = [
  { name: 'land', id: 'cur-land', title: 'Vilarejo no Campo', colors: 30 },
  { name: 'kit',  id: 'cur-kit',  title: 'Cozinha Aconchegante', colors: 30 },
  { name: 'lion', id: 'cur-lion', title: 'Safári', colors: 30 },
  { name: 'cot',  id: 'cur-cot',  title: 'Casa na Árvore', colors: 30 },
];

// shrink path data: round every coordinate to 1 decimal (0.1 of a 0-100 unit
// viewBox ~= 1px at 1000px render — invisible, but roughly halves the bytes).
function roundPath(d) {
  return d.replace(/-?\d+\.\d+/g, function (m) { return (Math.round(m * 10) / 10).toString(); });
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  page.on('console', m => console.log('  [page]', m.text()));
  await page.addScriptTag({ content: boardsJs });
  await page.addScriptTag({ content: pipelineJs });

  const boards = [];
  for (const job of JOBS) {
    const b64 = fs.readFileSync(path.join(GAME, 'assets', job.name + '.png')).toString('base64');
    const dataUrl = 'data:image/png;base64,' + b64;
    const board = await page.evaluate(async ({ dataUrl, job, GRID_LONG }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const scale = GRID_LONG / Math.max(img.width, img.height);
      const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, W, H);
      cx.drawImage(img, 0, 0, W, H);
      const id = cx.getImageData(0, 0, W, H);
      const b = window.Pipeline.fromLineArt(id, { colors: job.colors, title: job.title, id: job.id });
      return b;
    }, { dataUrl, job, GRID_LONG });
    board.id = job.id;
    board.title = job.title;
    for (const r of board.regions) r.geo.d = roundPath(r.geo.d);
    if (board.inkPath) board.inkPath = roundPath(board.inkPath);
    board.subtitle = board.regions.length + ' regiões · ' + board.palette.length + ' cores';
    boards.push(board);
    console.log(`${job.id}: ${board.regions.length} regions, ${board.palette.length} colors`);
  }
  await browser.close();

  const header = '/*\n * curated.js — acervo: quadros do Gemini convertidos com o pipeline de\n' +
    ' * line-art (cores chapadas por pixel + traço vetorial preenchido). Assado\n' +
    ' * offline por scratchpad/bake-curated.js. Fiel ao original, cheio de detalhe.\n */\n';
  const out = header + 'var CURATED = ' + JSON.stringify(boards) + ';\n' +
    'if (typeof module !== "undefined" && module.exports) module.exports = { CURATED: CURATED };\n' +
    'if (typeof window !== "undefined") window.CURATED = CURATED;\n';
  fs.writeFileSync(path.join(GAME, 'src/curated.js'), out);
  console.log('Wrote src/curated.js (' + out.length + ' bytes)');
})();
