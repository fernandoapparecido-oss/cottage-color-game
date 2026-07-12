// Bake a vector (SVG) source into a playable board and append it to curated.js.
// Uses the SAME runtime path as the in-app import (Pipeline.fromSVG): gradient
// banding + reveal-on-paint, so baked boards match what the app produces.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const GAME = '/home/user/project-context-poc/game';
const boardsJs = fs.readFileSync(path.join(GAME, 'src/boards.js'), 'utf8');
const pipelineJs = fs.readFileSync(path.join(GAME, 'src/pipeline.js'), 'utf8');
const svgText = fs.readFileSync(process.argv[2], 'utf8');
const JOB = { id: process.argv[3], title: process.argv[4] };

function roundPath(d) { return d.replace(/-?\d+\.\d+/g, function (m) { return (Math.round(m * 10) / 10).toString(); }); }

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('pageerror', e => console.log('ERR', String(e)));
  await page.addScriptTag({ content: boardsJs });
  await page.addScriptTag({ content: pipelineJs });

  const board = await page.evaluate(async ({ svgText, JOB }) => {
    return await window.Pipeline.fromSVG(svgText, { title: JOB.title, id: JOB.id, long: 1600 });
  }, { svgText, JOB });

  await browser.close();
  for (const r of board.regions) r.geo.d = roundPath(r.geo.d);
  if (board.inkPath) board.inkPath = roundPath(board.inkPath);
  board.subtitle = board.regions.length + ' regiões · ' + board.palette.length + ' cores';
  console.log(JOB.id + ': ' + board.regions.length + ' regions, ' + board.palette.length + ' colors');

  const cur = require(path.join(GAME, 'src/curated.js')).CURATED.filter(b => b.id !== JOB.id);
  cur.push(board);
  const header = '/*\n * curated.js — acervo. PNGs via fromLineArt, SVG via fromSVG (banding + reveal).\n */\n';
  const out = header + 'var CURATED = ' + JSON.stringify(cur) + ';\n' +
    'if (typeof module !== "undefined" && module.exports) module.exports = { CURATED: CURATED };\n' +
    'if (typeof window !== "undefined") window.CURATED = CURATED;\n';
  fs.writeFileSync(path.join(GAME, 'src/curated.js'), out);
  console.log('curated.js now has ' + cur.length + ' boards (' + out.length + ' bytes)');
})();
