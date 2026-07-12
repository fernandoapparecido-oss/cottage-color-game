/*
 * Bundles the multi-file app into one self-contained cottage-color.html so it
 * can be opened directly on a phone (published as an Artifact, no local server).
 * Run: node build.js
 */
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8').trim();
const css = read('src/styles.css');
const boards = read('src/boards.js');
const pipeline = read('src/pipeline.js');
const curated = read('src/curated.js');
const levels = read('src/levels.js');
const game = read('src/game.js');

let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
let body = html.split('<body>')[1].split('</body>')[0];
body = body.replace(/<script[\s\S]*?<\/script>/g, '').trim();

const out = [
  '<title>Cottage Color</title>',
  '<style>', css, '</style>', '',
  body, '',
  '<script>', boards, '</script>',
  '<script>', pipeline, '</script>',
  '<script>', curated, '</script>',
  '<script>', levels, '</script>',
  '<script>', game, '</script>', ''
].join('\n');

fs.writeFileSync(path.join(dir, 'cottage-color.html'), out);
console.log('Built cottage-color.html (' + out.length + ' bytes)');
