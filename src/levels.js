/*
 * Level data. A level is authored as a stack of shapes (back-to-front). At load
 * time boards.js bakes the stack into DISJOINT regions, so overlaps are resolved
 * (the topmost shape wins) and no fill can bleed into a neighbor's space.
 *
 *   shape : 'rect' | 'circle' | 'ellipse' | 'polygon'
 *   geo   : SVG-style attributes (x/y/width/height, cx/cy/r, cx/cy/rx/ry, points)
 *   color : 0-based index into palette
 *
 * Number labels and outlines are derived from the baked regions, not authored.
 */

const LEVELS = [
  {
    id: 'mushroom',
    title: 'Cogumelo',
    subtitle: 'Fácil',
    viewBox: '0 0 100 100',
    palette: ['#cdeaf2', '#86bd63', '#d1493f', '#f3ead6', '#efd9b0'],
    regions: [
      { shape: 'rect',    geo: { x: 0, y: 0, width: 100, height: 70 },  color: 0 },
      { shape: 'rect',    geo: { x: 0, y: 66, width: 100, height: 34 }, color: 1 },
      { shape: 'polygon', geo: { points: '42,50 58,50 62,80 38,80' },  color: 4 },
      // dome cap approximated as a polygon so it rasterizes without curves
      { shape: 'polygon', geo: { points: '20,53 32,40 44,33 50,32 56,33 68,40 80,53' }, color: 2 },
      { shape: 'circle',  geo: { cx: 38, cy: 45, r: 5 }, color: 3 },
      { shape: 'circle',  geo: { cx: 58, cy: 40, r: 6 }, color: 3 },
      { shape: 'circle',  geo: { cx: 66, cy: 50, r: 4 }, color: 3 }
    ]
  },
  {
    id: 'cottage',
    title: 'Casinha de Campo',
    subtitle: 'Médio',
    viewBox: '0 0 100 100',
    palette: [
      '#bfe3f0', '#f6c945', '#8fbf5f', '#f0dcbb', '#cf6a4c',
      '#825232', '#4f7d3f', '#e58aa8', '#9c3b2e', '#d9b382'
    ],
    regions: [
      { shape: 'rect',    geo: { x: 0, y: 0, width: 100, height: 64 },  color: 0 },
      { shape: 'rect',    geo: { x: 0, y: 62, width: 100, height: 38 }, color: 2 },
      { shape: 'circle',  geo: { cx: 82, cy: 16, r: 10 }, color: 1 },
      { shape: 'polygon', geo: { points: '46,72 54,72 62,100 38,100' }, color: 9 },
      { shape: 'rect',    geo: { x: 32, y: 42, width: 36, height: 30 }, color: 3 },
      { shape: 'polygon', geo: { points: '27,43 73,43 50,22' }, color: 4 },
      { shape: 'rect',    geo: { x: 57, y: 24, width: 6, height: 14 }, color: 8 },
      { shape: 'rect',    geo: { x: 45, y: 55, width: 10, height: 17 }, color: 5 },
      { shape: 'rect',    geo: { x: 36, y: 46, width: 8, height: 9 }, color: 0 },
      { shape: 'rect',    geo: { x: 56, y: 46, width: 8, height: 9 }, color: 0 },
      { shape: 'rect',    geo: { x: 12, y: 50, width: 5, height: 16 }, color: 5 },
      { shape: 'circle',  geo: { cx: 14.5, cy: 44, r: 12 }, color: 6 },
      { shape: 'ellipse', geo: { cx: 84, cy: 73, rx: 9, ry: 6 }, color: 6 },
      { shape: 'circle',  geo: { cx: 26, cy: 71, r: 4 }, color: 7 },
      { shape: 'circle',  geo: { cx: 73, cy: 71, r: 4 }, color: 7 }
    ]
  },
  buildGarden()
];

/*
 * A larger board generated procedurally to prove the engine scales to many
 * regions/colors (~50 regions, ~22 colors): a sunset tulip field. Every shape
 * is disjoint after baking; blooms cycle through a set of colors.
 */
function buildGarden() {
  const palette = [];
  const push = function (hex) { palette.push(hex); return palette.length - 1; };

  // sky bands (top -> horizon), a warm sunset
  const sky = ['#6a83b8', '#8f9fc4', '#b79dc0', '#e0a88f', '#f2c06a', '#f7d98f'].map(push);
  const sun = push('#ffd23f');
  const hillColors = ['#7a9b57', '#5f8248', '#456638'].map(push);
  const ground = push('#3a5730');
  const bloom = ['#d94f5c', '#e8756b', '#f2a65a', '#f6c945',
                 '#c86fa6', '#9b6bbf', '#e58aa8', '#cf4d4d'].map(push);
  const stem = push('#4f8a4a');
  const cloud = push('#f5f7f8');

  const regions = [];
  // sky bands across the top 55%
  const bandH = 55 / sky.length;
  sky.forEach(function (c, i) {
    regions.push({ shape: 'rect', geo: { x: 0, y: i * bandH, width: 100, height: bandH + 0.5 }, color: c });
  });
  // sun
  regions.push({ shape: 'circle', geo: { cx: 74, cy: 20, r: 11 }, color: sun });
  // clouds
  regions.push({ shape: 'ellipse', geo: { cx: 24, cy: 16, rx: 12, ry: 4.5 }, color: cloud });
  regions.push({ shape: 'ellipse', geo: { cx: 45, cy: 26, rx: 9, ry: 3.6 }, color: cloud });
  regions.push({ shape: 'ellipse', geo: { cx: 90, cy: 34, rx: 8, ry: 3.4 }, color: cloud });
  // rolling hills (drawn over lower sky)
  regions.push({ shape: 'ellipse', geo: { cx: 20, cy: 70, rx: 55, ry: 20 }, color: hillColors[0] });
  regions.push({ shape: 'ellipse', geo: { cx: 85, cy: 72, rx: 50, ry: 18 }, color: hillColors[1] });
  regions.push({ shape: 'ellipse', geo: { cx: 55, cy: 82, rx: 70, ry: 20 }, color: hillColors[2] });
  // ground band at the very bottom
  regions.push({ shape: 'rect', geo: { x: 0, y: 88, width: 100, height: 12 }, color: ground });

  // tulips: 3 rows x 6, staggered; each = stem (drawn first) then bloom on top
  let b = 0;
  const rows = [
    { y: 74, r: 3.0, xs: [10, 26, 42, 58, 74, 90] },
    { y: 82, r: 3.6, xs: [6, 22, 38, 54, 70, 86] },
    { y: 91, r: 4.2, xs: [14, 30, 46, 62, 78, 94] }
  ];
  rows.forEach(function (row) {
    row.xs.forEach(function (x) {
      regions.push({ shape: 'rect', geo: { x: x - 0.5, y: row.y, width: 1, height: 12 }, color: stem });
      // tulip cup as a small polygon
      const r = row.r;
      regions.push({
        shape: 'polygon',
        geo: { points:
          (x - r) + ',' + (row.y - r * 0.2) + ' ' +
          (x - r * 0.55) + ',' + (row.y - r * 1.5) + ' ' +
          x + ',' + (row.y - r * 0.8) + ' ' +
          (x + r * 0.55) + ',' + (row.y - r * 1.5) + ' ' +
          (x + r) + ',' + (row.y - r * 0.2) + ' ' +
          x + ',' + (row.y + r * 0.9) },
        color: bloom[b % bloom.length]
      });
      b++;
    });
  });

  return {
    id: 'garden',
    title: 'Campo de Tulipas',
    subtitle: 'Grande · ' + palette.length + ' cores',
    viewBox: '0 0 100 100',
    palette: palette,
    regions: regions
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { LEVELS: LEVELS, buildGarden: buildGarden };
if (typeof window !== 'undefined') window.LEVELS = LEVELS;
