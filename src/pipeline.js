/*
 * pipeline.js — turn a photo into a playable color-by-number board, entirely on
 * the device. Given a downscaled ImageData it:
 *
 *   1. quantizes to K colors (median-cut)
 *   2. segments into connected same-color regions
 *   3. merges tiny specks into their neighbor (so nothing is impossible to tap)
 *   4. vectorizes the region map via the shared boards.js vectorizer
 *
 * The output is the exact board format the engine already renders, so uploaded
 * images and hand-made levels play through one code path.
 *
 * Pure module (no DOM): the UI draws the image to a canvas and passes ImageData.
 */
(function (global) {
  'use strict';

  const Boards = global.Boards || (typeof require !== 'undefined' && require('./boards.js'));

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return ('0' + Math.max(0, Math.min(255, v | 0)).toString(16)).slice(-2);
    }).join('');
  }

  // ---- median-cut color quantization -------------------------------------
  function quantize(data, n, K, iterations) {
    const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n);
    for (let i = 0; i < n; i++) { R[i] = data[i * 4]; G[i] = data[i * 4 + 1]; B[i] = data[i * 4 + 2]; }

    function makeBox(idx) {
      let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k], r = R[i], g = G[i], b = B[i];
        if (r < rmin) rmin = r; if (r > rmax) rmax = r;
        if (g < gmin) gmin = g; if (g > gmax) gmax = g;
        if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      }
      return { idx: idx, rr: rmax - rmin, gr: gmax - gmin, br: bmax - bmin };
    }

    const all = new Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    let boxes = [makeBox(all)];

    while (boxes.length < K) {
      let bi = -1, best = -1;
      for (let i = 0; i < boxes.length; i++) {
        const bx = boxes[i];
        if (bx.idx.length < 2) continue;
        const range = Math.max(bx.rr, bx.gr, bx.br);
        if (range > best) { best = range; bi = i; }
      }
      if (bi < 0) break;
      const bx = boxes[bi];
      const ch = bx.rr >= bx.gr && bx.rr >= bx.br ? R : (bx.gr >= bx.br ? G : B);
      bx.idx.sort(function (a, b) { return ch[a] - ch[b]; });
      const mid = bx.idx.length >> 1;
      boxes.splice(bi, 1, makeBox(bx.idx.slice(0, mid)), makeBox(bx.idx.slice(mid)));
    }

    // Median-cut gives the starting cluster centers…
    let cx = boxes.map(function (bx) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < bx.idx.length; k++) { const i = bx.idx[k]; r += R[i]; g += G[i]; b += B[i]; }
      const m = bx.idx.length || 1;
      return [r / m, g / m, b / m];
    });
    const Kc = cx.length;
    const indices = new Uint8Array(n);

    // …then a few k-means (Lloyd) iterations sharpen them to the real colors,
    // which is the single biggest win for how recognizable the result looks.
    const it = iterations == null ? 4 : iterations;
    const sr = new Float64Array(Kc), sg = new Float64Array(Kc), sb = new Float64Array(Kc);
    const cnt = new Int32Array(Kc);
    for (let pass = 0; ; pass++) {
      for (let i = 0; i < n; i++) {
        const r = R[i], g = G[i], b = B[i];
        let bestD = Infinity, bestK = 0;
        for (let k = 0; k < Kc; k++) {
          const c = cx[k];
          const dr = r - c[0], dg = g - c[1], db = b - c[2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; bestK = k; }
        }
        indices[i] = bestK;
      }
      if (pass >= it) break;
      sr.fill(0); sg.fill(0); sb.fill(0); cnt.fill(0);
      for (let i = 0; i < n; i++) { const k = indices[i]; sr[k] += R[i]; sg[k] += G[i]; sb[k] += B[i]; cnt[k]++; }
      for (let k = 0; k < Kc; k++) {
        if (cnt[k]) cx[k] = [sr[k] / cnt[k], sg[k] / cnt[k], sb[k] / cnt[k]];
      }
    }

    const palette = cx.map(function (c) {
      return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
    });
    return { palette: palette, indices: indices };
  }

  // ---- 3x3 majority filter: removes salt-and-pepper noise before segmenting,
  //      which both improves quality and slashes the region count -----------
  function modeSmooth(indices, W, H, K, passes) {
    let src = indices;
    const tally = new Int32Array(K);
    const touched = [];
    for (let pass = 0; pass < passes; pass++) {
      const dst = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          touched.length = 0;
          const self = src[y * W + x];
          let bestV = self, bestN = -1;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy; if (ny < 0 || ny >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx; if (nx < 0 || nx >= W) continue;
              const v = src[ny * W + nx];
              if (tally[v] === 0) touched.push(v);
              tally[v]++;
              if (tally[v] > bestN || (tally[v] === bestN && v === self)) { bestN = tally[v]; bestV = v; }
            }
          }
          dst[y * W + x] = bestV;
          for (let t = 0; t < touched.length; t++) tally[touched[t]] = 0;
        }
      }
      src = dst;
    }
    return src;
  }

  // ---- merge near-duplicate palette colors -------------------------------
  // Quantization often yields several almost-identical shades (three blues for
  // Mario's overalls). Union those within `thr` so areas read as one flat color
  // instead of a blotchy patchwork. New color = pixel-count-weighted average.
  function mergeSimilarColors(palette, indices, n, thr) {
    const K = palette.length;
    const parent = []; for (let i = 0; i < K; i++) parent[i] = i;
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (let i = 0; i < K; i++) {
      for (let j = i + 1; j < K; j++) {
        const a = palette[i], b = palette[j];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d < thr) parent[find(i)] = find(j);
      }
    }
    const count = new Float64Array(K);
    for (let i = 0; i < n; i++) count[indices[i]]++;
    const remap = new Int32Array(K); const groups = {};
    for (let i = 0; i < K; i++) { const r = find(i); (groups[r] || (groups[r] = [])).push(i); }
    const newPal = []; let nc = 0;
    for (const r in groups) {
      const g = groups[r]; let sr = 0, sg = 0, sb = 0, w = 0;
      g.forEach(function (i) { const c = count[i] || 1; sr += palette[i][0] * c; sg += palette[i][1] * c; sb += palette[i][2] * c; w += c; });
      newPal.push([Math.round(sr / w), Math.round(sg / w), Math.round(sb / w)]);
      g.forEach(function (i) { remap[i] = nc; }); nc++;
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = remap[indices[i]];
    return { palette: newPal, indices: out };
  }

  // ---- connected components (4-connectivity) -----------------------------
  function connectedComponents(indices, W, H) {
    const labels = new Int32Array(W * H).fill(-1);
    const regionColor = [];
    const stack = [];
    let cur = 0;
    for (let s = 0; s < W * H; s++) {
      if (labels[s] !== -1) continue;
      const col = indices[s];
      labels[s] = cur; regionColor[cur] = col;
      stack.length = 0; stack.push(s);
      while (stack.length) {
        const p = stack.pop();
        const x = p % W;
        if (x + 1 < W && labels[p + 1] === -1 && indices[p + 1] === col) { labels[p + 1] = cur; stack.push(p + 1); }
        if (x - 1 >= 0 && labels[p - 1] === -1 && indices[p - 1] === col) { labels[p - 1] = cur; stack.push(p - 1); }
        if (p + W < W * H && labels[p + W] === -1 && indices[p + W] === col) { labels[p + W] = cur; stack.push(p + W); }
        if (p - W >= 0 && labels[p - W] === -1 && indices[p - W] === col) { labels[p - W] = cur; stack.push(p - W); }
      }
      cur++;
    }
    return { labels: labels, regionColor: regionColor, count: cur };
  }

  // ---- absorb tiny OR thin regions into their strongest neighbor ----------
  // minArea kills specks; minThick kills slivers — a region whose mean width
  // (2·area/perimeter) is under a few pixels is basically a line you can't tap,
  // so it's folded into the neighbor it borders most.
  function mergeSmall(labels, regionColor, W, H, minArea, minThick) {
    minThick = minThick || 0;
    const count = regionColor.length;
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }

    let changed = true, guard = 0;
    while (changed && guard++ < 16) {
      changed = false;
      // adjacency: root -> Map(neighborRoot -> shared border length), + areas
      const area = new Map();
      const adj = new Map();
      for (let i = 0; i < W * H; i++) { const r = find(labels[i]); area.set(r, (area.get(r) || 0) + 1); }
      function link(a, b) {
        if (a === b) return;
        let m = adj.get(a); if (!m) { m = new Map(); adj.set(a, m); } m.set(b, (m.get(b) || 0) + 1);
        let n2 = adj.get(b); if (!n2) { n2 = new Map(); adj.set(b, n2); } n2.set(a, (n2.get(a) || 0) + 1);
      }
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const p = y * W + x, a = find(labels[p]);
          if (x + 1 < W) link(a, find(labels[p + 1]));
          if (y + 1 < H) link(a, find(labels[p + W]));
        }
      }
      const smalls = [];
      area.forEach(function (a, r) {
        let mergeIt = a < minArea;
        if (!mergeIt && minThick > 0) {
          const nb = adj.get(r); let perim = 0;
          if (nb) nb.forEach(function (c) { perim += c; });
          if (perim > 0 && (2 * a / perim) < minThick) mergeIt = true;
        }
        if (mergeIt) smalls.push(r);
      });
      smalls.sort(function (a, b) { return area.get(a) - area.get(b); });
      for (let s = 0; s < smalls.length; s++) {
        const r = smalls[s];
        if (find(r) !== r) continue;
        const nbrs = adj.get(r);
        if (!nbrs) continue;
        let best = -1, bestC = -1;
        nbrs.forEach(function (c, other) {
          other = find(other);
          if (other === r) return;
          if (c > bestC) { bestC = c; best = other; }
        });
        if (best >= 0) { parent[r] = best; changed = true; }
      }
    }

    const remap = {}; let nc = 0; const newColor = [];
    const out = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = find(labels[i]);
      if (remap[r] === undefined) { remap[r] = nc; newColor[nc] = regionColor[r]; nc++; }
      out[i] = remap[r];
    }
    return { labels: out, regionColor: newColor, count: nc };
  }

  // ---- edge-aware segmentation (for line-art / illustrations) ------------
  // The dark outlines the artist drew ARE the region boundaries. We mark those
  // pixels as walls, flood the areas between them into regions, then split the
  // wall pixels between the regions they separate.
  function edgeMask(data, W, H, darkT, gradT) {
    const n = W * H;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const mask = new Uint8Array(n);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx > 0 ? (mx - mn) / mx : 0;
        // a dark, low-saturation pixel is an ink line
        let edge = (L[i] < darkT && sat < 0.4) ? 1 : 0;
        if (!edge) {
          const lx = x + 1 < W ? L[i + 1] : L[i];
          const ly = y + 1 < H ? L[i + W] : L[i];
          if (Math.abs(L[i] - lx) + Math.abs(L[i] - ly) > gradT) edge = 1;
        }
        mask[i] = edge;
      }
    }
    return mask;
  }

  function segmentByEdges(mask, W, H) {
    const n = W * H;
    const labels = new Int32Array(n).fill(-1);
    const stack = [];
    let cur = 0;
    for (let s = 0; s < n; s++) {
      if (mask[s] || labels[s] !== -1) continue;
      labels[s] = cur; stack.length = 0; stack.push(s);
      while (stack.length) {
        const p = stack.pop(), x = p % W;
        if (x + 1 < W && !mask[p + 1] && labels[p + 1] === -1) { labels[p + 1] = cur; stack.push(p + 1); }
        if (x - 1 >= 0 && !mask[p - 1] && labels[p - 1] === -1) { labels[p - 1] = cur; stack.push(p - 1); }
        if (p + W < n && !mask[p + W] && labels[p + W] === -1) { labels[p + W] = cur; stack.push(p + W); }
        if (p - W >= 0 && !mask[p - W] && labels[p - W] === -1) { labels[p - W] = cur; stack.push(p - W); }
      }
      cur++;
    }
    // grow regions into the wall pixels (multi-source BFS) so nothing is left -1
    const q = []; let head = 0;
    for (let i = 0; i < n; i++) if (labels[i] >= 0) q.push(i);
    while (head < q.length) {
      const p = q[head++], x = p % W, lab = labels[p];
      if (x + 1 < W && labels[p + 1] === -1) { labels[p + 1] = lab; q.push(p + 1); }
      if (x - 1 >= 0 && labels[p - 1] === -1) { labels[p - 1] = lab; q.push(p - 1); }
      if (p + W < n && labels[p + W] === -1) { labels[p + W] = lab; q.push(p + W); }
      if (p - W >= 0 && labels[p - W] === -1) { labels[p - W] = lab; q.push(p - W); }
    }
    return { labels: labels, count: cur };
  }

  // average color of each region, from its non-wall pixels (ink excluded)
  function regionColors(data, mask, labels, count, W, H) {
    const sr = new Float64Array(count), sg = new Float64Array(count), sb = new Float64Array(count), cn = new Int32Array(count);
    const ar = new Float64Array(count), ag = new Float64Array(count), ab = new Float64Array(count), an = new Int32Array(count);
    for (let i = 0; i < W * H; i++) {
      const lab = labels[i]; if (lab < 0) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      ar[lab] += r; ag[lab] += g; ab[lab] += b; an[lab]++;
      if (!mask[i]) { sr[lab] += r; sg[lab] += g; sb[lab] += b; cn[lab]++; }
    }
    const colors = [], area = [];
    for (let k = 0; k < count; k++) {
      if (cn[k] > 0) colors[k] = [sr[k] / cn[k], sg[k] / cn[k], sb[k] / cn[k]];
      else colors[k] = [ar[k] / (an[k] || 1), ag[k] / (an[k] || 1), ab[k] / (an[k] || 1)];
      area[k] = an[k];
    }
    return { colors: colors, area: area };
  }

  // weighted k-means over region colors -> compact palette + per-region index
  function paletteFromRegions(colors, weights, K, iters) {
    const R = colors.length;
    const k = Math.min(K, R);
    let seed = 987654321;
    const rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const centers = [colors[0].slice()];
    const d2 = new Float64Array(R).fill(Infinity);
    while (centers.length < k) {
      const c = centers[centers.length - 1];
      let tot = 0;
      for (let i = 0; i < R; i++) {
        const dr = colors[i][0] - c[0], dg = colors[i][1] - c[1], db = colors[i][2] - c[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < d2[i]) d2[i] = d;
        tot += d2[i] * weights[i];
      }
      let r = rnd() * tot, pick = 0;
      for (let i = 0; i < R; i++) { r -= d2[i] * weights[i]; if (r <= 0) { pick = i; break; } pick = i; }
      centers.push(colors[pick].slice());
    }
    const assign = new Int32Array(R);
    const it = iters == null ? 6 : iters;
    for (let pass = 0; pass < it; pass++) {
      for (let i = 0; i < R; i++) {
        let bd = Infinity, bk = 0;
        for (let c = 0; c < centers.length; c++) {
          const dr = colors[i][0] - centers[c][0], dg = colors[i][1] - centers[c][1], db = colors[i][2] - centers[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; bk = c; }
        }
        assign[i] = bk;
      }
      const sr = new Float64Array(centers.length), sg = new Float64Array(centers.length), sb = new Float64Array(centers.length), sw = new Float64Array(centers.length);
      for (let i = 0; i < R; i++) { const c = assign[i], w = weights[i]; sr[c] += colors[i][0] * w; sg[c] += colors[i][1] * w; sb[c] += colors[i][2] * w; sw[c] += w; }
      for (let c = 0; c < centers.length; c++) if (sw[c] > 0) centers[c] = [sr[c] / sw[c], sg[c] / sw[c], sb[c] / sw[c]];
    }
    return {
      palette: centers.map(function (c) { return rgbToHex(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])); }),
      assign: assign
    };
  }

  // ---- keep the line work, hollow out big dark fills ----------------------
  // Erode the ink mask by t, then keep only (mask AND NOT eroded): the border
  // band of thickness ~t around every ink area. Thin lines (width <= 2t) survive
  // whole; large solid shapes (a mustache) collapse to just their outline, so
  // they don't paint a black blob over a colorable region.
  function thinInk(mask, W, H, t) {
    const n = W * H;
    let er = mask;
    for (let pass = 0; pass < t; pass++) {
      const next = new Uint8Array(n);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!er[i]) continue;
          if (x > 0 && er[i - 1] && x < W - 1 && er[i + 1] &&
              y > 0 && er[i - W] && y < H - 1 && er[i + W]) next[i] = 1;
        }
      }
      er = next;
    }
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (mask[i] && !er[i]) out[i] = 1;
    return out;
  }

  // =========================================================================
  //  Structure-first pipeline (designed with Fable)
  //  Extract walls (ink lines + gradient edges) FIRST, flood-fill regions
  //  between them, and let color in only at the region level. Dark line/shadow
  //  pixels become walls (absorbed into neighbors) instead of black fill blobs.
  // =========================================================================

  // sRGB -> CIELab, and ΔE (perceptual color distance)
  function srgbToLab(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    let X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let Y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
    let Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function deltaE(a, b) {
    const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // dark, low-saturation pixels = candidate ink/shadow
  function darkMask(data, W, H, darkT) {
    const n = W * H, m = new Uint8Array(n); let cnt = 0;
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      if (L < darkT && sat < 0.45) { m[i] = 1; cnt++; }
    }
    return { mask: m, frac: cnt / n };
  }

  // chamfer (3,4) distance transform: distance (×3) to nearest 0 pixel
  function chamferDT(mask, W, H) {
    const n = W * H, INF = 1 << 28, d = new Int32Array(n);
    for (let i = 0; i < n; i++) d[i] = mask[i] ? INF : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (!d[i]) continue; let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 3);
      if (y > 0) m = Math.min(m, d[i - W] + 3);
      if (x > 0 && y > 0) m = Math.min(m, d[i - W - 1] + 4);
      if (x < W - 1 && y > 0) m = Math.min(m, d[i - W + 1] + 4);
      d[i] = m;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; if (!d[i]) continue; let m = d[i];
      if (x < W - 1) m = Math.min(m, d[i + 1] + 3);
      if (y < H - 1) m = Math.min(m, d[i + W] + 3);
      if (x < W - 1 && y < H - 1) m = Math.min(m, d[i + W + 1] + 4);
      if (x > 0 && y < H - 1) m = Math.min(m, d[i + W - 1] + 4);
      d[i] = m;
    }
    return d;
  }

  // separable 3-tap binomial blur of RGB (for gradients only)
  function blurRGB(data, W, H) {
    const n = W * H;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, l = x > 0 ? i - 1 : i, r = x < W - 1 ? i + 1 : i;
      R[i] = (data[l * 4] + 2 * data[i * 4] + data[r * 4]) / 4;
      G[i] = (data[l * 4 + 1] + 2 * data[i * 4 + 1] + data[r * 4 + 1]) / 4;
      B[i] = (data[l * 4 + 2] + 2 * data[i * 4 + 2] + data[r * 4 + 2]) / 4;
    }
    const R2 = new Float32Array(n), G2 = new Float32Array(n), B2 = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, u = y > 0 ? i - W : i, dn = y < H - 1 ? i + W : i;
      R2[i] = (R[u] + 2 * R[i] + R[dn]) / 4; G2[i] = (G[u] + 2 * G[i] + G[dn]) / 4; B2[i] = (B[u] + 2 * B[i] + B[dn]) / 4;
    }
    return [R2, G2, B2];
  }

  // Canny-style edges: per-channel Sobel (max) -> NMS -> adaptive hysteresis
  function cannyEdges(blur, W, H) {
    const n = W * H, mag = new Float32Array(n), ori = new Uint8Array(n);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; let bm = -1, bgx = 0, bgy = 0;
      for (let c = 0; c < 3; c++) {
        const C = blur[c];
        const gx = -C[i - W - 1] - 2 * C[i - 1] - C[i + W - 1] + C[i - W + 1] + 2 * C[i + 1] + C[i + W + 1];
        const gy = -C[i - W - 1] - 2 * C[i - W] - C[i - W + 1] + C[i + W - 1] + 2 * C[i + W] + C[i + W + 1];
        const m = Math.abs(gx) + Math.abs(gy);
        if (m > bm) { bm = m; bgx = gx; bgy = gy; }
      }
      mag[i] = bm / 8;
      const agx = Math.abs(bgx), agy = Math.abs(bgy);
      ori[i] = agx > 2.414 * agy ? 0 : agy > 2.414 * agx ? 2 : (bgx * bgy > 0 ? 1 : 3);
    }
    // non-maximum suppression along the gradient direction
    const off = [[-1, 1], [-W - 1, W + 1], [-W, W], [-W + 1, W - 1]];
    const nm = new Float32Array(n);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = mag[i], o = off[ori[i]];
      if (m >= mag[i + o[0]] && m >= mag[i + o[1]]) nm[i] = m;
    }
    // adaptive thresholds from the 90th percentile of NMS survivors
    const hist = new Int32Array(256); let cnt = 0;
    for (let i = 0; i < n; i++) if (nm[i] > 0) { hist[Math.min(255, nm[i] | 0)]++; cnt++; }
    let acc = 0, thi = 24; const target = cnt * 0.90;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) { thi = v; break; } }
    thi = Math.max(24, Math.min(72, thi)); const tlo = Math.max(10, thi * 0.4);
    const E = new Uint8Array(n), st = [];
    for (let i = 0; i < n; i++) if (nm[i] >= thi) { E[i] = 1; st.push(i); }
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!E[q] && nm[q] >= tlo) { E[q] = 1; st.push(q); }
      }
    }
    return E;
  }

  function dilate1(m, W, H) {
    const n = W * H, o = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (m[i]) { o[i] = 1; continue; }
      if ((x > 0 && m[i - 1]) || (x < W - 1 && m[i + 1]) || (y > 0 && m[i - W]) || (y < H - 1 && m[i + W]) ||
          (x > 0 && y > 0 && m[i - W - 1]) || (x < W - 1 && y > 0 && m[i - W + 1]) ||
          (x > 0 && y < H - 1 && m[i + W - 1]) || (x < W - 1 && y < H - 1 && m[i + W + 1])) o[i] = 1;
    }
    return o;
  }

  // 4-connected erosion, r passes. Peels the outer pixel off every ink stroke
  // so the drawn line reads thinner / more delicate, without breaking it into
  // dashes the way a skeleton would. A stroke <=2r px wide would vanish, so r
  // stays small; strokes are only thinned where they can afford it.
  function erodeMask(mask, W, H, r) {
    let cur = mask;
    for (let pass = 0; pass < r; pass++) {
      const nx = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!cur[i]) continue;
        if (x > 0 && x < W - 1 && y > 0 && y < H - 1 &&
            cur[i - 1] && cur[i + 1] && cur[i - W] && cur[i + W]) nx[i] = 1;
      }
      cur = nx;
    }
    return cur;
  }

  // Line detector for COLORED line art. The artist's outlines are often dark
  // BROWN, not black, so a saturation veto (as in darkMask/widenInk) drops them
  // and they survive as thick dark fill regions that a dark paint blends into.
  // Here a pixel is ink if it's a near-neutral dark core OR a dark RIDGE (darker
  // than both opposite sides by ridgeT) of ANY hue — which catches brown/black
  // strokes but not broad dark shadows (a shadow's interior isn't a ridge).
  function lineMask(data, W, H, darkT, ridgeT) {
    const n = W * H, L = new Float32Array(n), sat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx > 0 ? (mx - mn) / mx : 0;
    }
    const m = new Uint8Array(n);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, li = L[i];
      if (li < darkT && sat[i] < 0.35) { m[i] = 1; continue; }   // neutral black core
      if (li > 175) continue;                                    // clearly light: skip
      if ((L[i - 1] - li > ridgeT && L[i + 1] - li > ridgeT) ||
          (L[i - W] - li > ridgeT && L[i + W] - li > ridgeT) ||
          (L[i - W - 1] - li > ridgeT && L[i + W + 1] - li > ridgeT) ||
          (L[i - W + 1] - li > ridgeT && L[i + W - 1] - li > ridgeT)) m[i] = 1;
    }
    return dilate1(m, W, H);   // ridge is a centerline; recover the stroke body
  }

  // Fuller ink mask than the strong dark seed: adds a dark-RIDGE term (a local
  // brightness minimum across a thin line — catches anti-aliased strokes the
  // hard threshold misses) and hysteresis-links weak-dark pixels to a seed, so
  // the artist's linework comes out continuous instead of broken/dotted.
  function widenInk(data, W, H, darkT) {
    const n = W * H;
    const L = new Float32Array(n), sat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx > 0 ? (mx - mn) / mx : 0;
    }
    const seed = new Uint8Array(n), RIDGE = 24;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (L[i] < darkT && sat[i] < 0.45) { seed[i] = 1; continue; }
      if (sat[i] >= 0.5) continue;
      const li = L[i];
      if ((L[i - 1] - li > RIDGE && L[i + 1] - li > RIDGE) ||
          (L[i - W] - li > RIDGE && L[i + W] - li > RIDGE) ||
          (L[i - W - 1] - li > RIDGE && L[i + W + 1] - li > RIDGE) ||
          (L[i - W + 1] - li > RIDGE && L[i + W - 1] - li > RIDGE)) seed[i] = 1;
    }
    const INK = new Uint8Array(n), st = [];
    for (let i = 0; i < n; i++) if (seed[i]) { INK[i] = 1; st.push(i); }
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!INK[q] && L[q] < 135 && sat[q] < 0.5) { INK[q] = 1; st.push(q); }
      }
    }
    return INK;
  }

  // Edge-aware agglomerative region merge. Cost = ΔE(Lab) scaled up across inked
  // borders (drawn lines), so the artist's cells stay separate while shading
  // fragments and slivers fold together. Repeated-pass union-find.
  function edgeAwareMerge(labels, count, data, wall, D, W, H, P) {
    const n = W * H;
    const sr = new Float64Array(count), sg = new Float64Array(count), sb = new Float64Array(count);
    const cc = new Int32Array(count), area = new Int32Array(count);
    for (let i = 0; i < n; i++) {
      const l = labels[i]; area[l]++;
      if (!wall[i]) { sr[l] += data[i * 4]; sg[l] += data[i * 4 + 1]; sb[l] += data[i * 4 + 2]; cc[l]++; }
    }
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }

    function doPass(selector) {
      const rA = new Float64Array(count), rr = new Float64Array(count), rg = new Float64Array(count),
            rb = new Float64Array(count), rc = new Float64Array(count);
      for (let i = 0; i < count; i++) { const r = find(i); rA[r] += area[i]; rr[r] += sr[i]; rg[r] += sg[i]; rb[r] += sb[i]; rc[r] += cc[i]; }
      const labCache = new Map();
      function lab(r) { let v = labCache.get(r); if (!v) { const d = rc[r] || 1; v = srgbToLab(rr[r] / d, rg[r] / d, rb[r] / d); labCache.set(r, v); } return v; }
      const adj = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (x + 1 < W) { const a = find(labels[p]), b = find(labels[p + 1]); if (a !== b) { const k = a < b ? a * count + b : b * count + a; let e = adj.get(k); if (!e) { e = [0, 0]; adj.set(k, e); } e[0]++; if (D[p] || D[p + 1]) e[1]++; } }
        if (y + 1 < H) { const a = find(labels[p]), b = find(labels[p + W]); if (a !== b) { const k = a < b ? a * count + b : b * count + a; let e = adj.get(k); if (!e) { e = [0, 0]; adj.set(k, e); } e[0]++; if (D[p] || D[p + W]) e[1]++; } }
      }
      const cands = [];
      adj.forEach(function (e, k) {
        const a = Math.floor(k / count), b = k % count;
        const cost = selector(a, b, e[0], e[1], rA[a], rA[b], lab(a), lab(b));
        if (cost >= 0) cands.push([cost, a, b]);
      });
      cands.sort(function (u, v) { return u[0] - v[0]; });
      const touched = new Set(); let any = false;
      for (let i = 0; i < cands.length; i++) {
        const a = find(cands[i][1]), b = find(cands[i][2]);
        if (a === b || touched.has(a) || touched.has(b)) continue;
        // attach smaller area into larger
        if (rA[a] > rA[b]) parent[b] = a; else parent[a] = b;
        touched.add(a); touched.add(b); any = true;
      }
      return any;
    }
    function roots() { let c = 0; for (let i = 0; i < count; i++) if (find(i) === i) c++; return c; }

    // Phase 1: absorb slivers into their most similar neighbor (ink veto ignored)
    let it = 0;
    while (it++ < 40 && doPass(function (a, b, bd, ink, aA, aB, lA, lB) {
      if (aA >= P.minArea && aB >= P.minArea) return -1;
      return deltaE(lA, lB);
    })) {}
    // Phase 2: general edge-aware merge (never cross a strongly-inked border)
    it = 0;
    while (it++ < 40 && doPass(function (a, b, bd, ink, aA, aB, lA, lB) {
      const inkFrac = ink / bd;
      if (inkFrac > 0.5) return -1;
      const cost = deltaE(lA, lB) * (1 + 4 * Math.min(inkFrac / 0.5, 1));
      return cost <= P.MERGE_T ? cost : -1;
    })) {}
    // Phase 3: cap region count (merge cheapest by ΔE, veto relaxed)
    it = 0;
    while (roots() > P.maxRegions && it++ < 60) {
      doPass(function (a, b, bd, ink, aA, aB, lA, lB) { return deltaE(lA, lB); });
    }

    // relabel to 0..R-1
    const remap = new Int32Array(count).fill(-1); let nc = 0;
    for (let i = 0; i < count; i++) { const r = find(i); if (remap[r] < 0) remap[r] = nc++; }
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = remap[find(labels[i])];
    return { labels: out, count: nc };
  }

  // Split regions that flooded across a low-contrast boundary (e.g. light skin
  // vs light background where the edge detector didn't fire). k-means k=2 in Lab
  // on each oversized region; if the two colors are far apart, re-split. Uses a
  // precomputed Lab image so it stays cheap.
  function splitOversized(labels, count, labImg, wall, W, H) {
    const n = W * H;
    let L = labels, C = count;
    for (let depth = 0; depth < 2; depth++) {
      const area = new Int32Array(C);
      for (let i = 0; i < n; i++) area[L[i]]++;
      const bigSet = new Set();
      for (let l = 0; l < C; l++) if (area[l] > 0.02 * n) bigSet.add(l);
      if (!bigSet.size) break;

      const samples = {}; bigSet.forEach(function (l) { samples[l] = []; });
      for (let i = 0; i < n; i += 4) {
        const l = L[i];
        if (bigSet.has(l) && !wall[i]) samples[l].push(i);
      }
      const centers = {}; let idCounter = C;
      bigSet.forEach(function (l) {
        const s = samples[l];
        if (s.length < 24) { centers[l] = null; return; }
        let c0 = lab(s[0]), c1 = c0, md = -1;
        for (let k = 0; k < s.length; k++) { const d = de(lab(s[k]), c0); if (d > md) { md = d; c1 = lab(s[k]); } }
        for (let it = 0; it < 6; it++) {
          let a0 = 0, b0 = 0, l0 = 0, n0 = 0, a1 = 0, b1 = 0, l1 = 0, n1 = 0;
          for (let k = 0; k < s.length; k++) {
            const p = lab(s[k]);
            if (de(p, c0) <= de(p, c1)) { l0 += p[0]; a0 += p[1]; b0 += p[2]; n0++; }
            else { l1 += p[0]; a1 += p[1]; b1 += p[2]; n1++; }
          }
          if (n0) c0 = [l0 / n0, a0 / n0, b0 / n0];
          if (n1) c1 = [l1 / n1, a1 / n1, b1 / n1];
        }
        centers[l] = de(c0, c1) > 22 ? [c0, c1] : null;
      });
      function lab(i) { return [labImg[i * 3], labImg[i * 3 + 1], labImg[i * 3 + 2]]; }
      function de(p, q) { const x = p[0] - q[0], y = p[1] - q[1], z = p[2] - q[2]; return Math.sqrt(x * x + y * y + z * z); }

      const newId = {}; let changed = false;
      bigSet.forEach(function (l) { if (centers[l]) newId[l] = idCounter++; });
      const nl = Int32Array.from(L);
      for (let i = 0; i < n; i++) {
        const l = L[i]; const cs = centers[l];
        if (cs) { const p = lab(i); if (de(p, cs[1]) < de(p, cs[0])) { nl[i] = newId[l]; changed = true; } }
      }
      L = nl; C = idCounter;
      if (!changed) break;
    }
    return { labels: L, count: C };
  }

  // Fold adjacent regions that ended up the SAME palette color into one — kills
  // the scattered same-color specks (dozens of green leaves), so the board has
  // few, large, tappable regions with legible numbers. The ink overlay still
  // carries the fine detail. This is what makes it play like a real game.
  function foldSameColor(labels, colorIdx, count, W, H) {
    const n = W * H;
    const parent = new Int32Array(count);
    for (let i = 0; i < count; i++) parent[i] = i;
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (x + 1 < W) { const a = labels[p], b = labels[p + 1]; if (a !== b && colorIdx[a] === colorIdx[b]) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; } }
      if (y + 1 < H) { const a = labels[p], b = labels[p + W]; if (a !== b && colorIdx[a] === colorIdx[b]) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; } }
    }
    const remap = new Int32Array(count).fill(-1); let nc = 0; const newColor = [];
    for (let i = 0; i < count; i++) { const r = find(i); if (remap[r] < 0) { remap[r] = nc; newColor[nc] = colorIdx[r]; nc++; } }
    const out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = remap[find(labels[i])];
    return { labels: out, count: nc, colorIndex: newColor };
  }

  // median-cut + k-means over ONLY the painted (non-ink) pixels. Flat art has
  // few, well-separated colors, so pixel-level quantization keeps them exact —
  // no region-averaging/re-clustering that muddies blue & brown into beige.
  function quantizeMasked(data, W, H, ink, K) {
    const n = W * H;
    const px = [];
    for (let i = 0; i < n; i++) if (!ink[i]) px.push(i);
    if (!px.length) return { index: new Int32Array(n).fill(-1), palette: [[0, 0, 0]] };
    function box(list) {
      let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (let k = 0; k < list.length; k++) {
        const i = list[k], r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        if (r < rmin) rmin = r; if (r > rmax) rmax = r;
        if (g < gmin) gmin = g; if (g > gmax) gmax = g;
        if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      }
      return { list: list, rr: rmax - rmin, gr: gmax - gmin, br: bmax - bmin };
    }
    let boxes = [box(px)];
    while (boxes.length < K) {
      let bi = -1, best = -1;
      for (let i = 0; i < boxes.length; i++) {
        const bx = boxes[i]; if (bx.list.length < 2) continue;
        const range = Math.max(bx.rr, bx.gr, bx.br);
        if (range > best) { best = range; bi = i; }
      }
      if (bi < 0) break;
      const bx = boxes[bi];
      const off = bx.rr >= bx.gr && bx.rr >= bx.br ? 0 : (bx.gr >= bx.br ? 1 : 2);
      bx.list.sort(function (a, b) { return data[a * 4 + off] - data[b * 4 + off]; });
      const mid = bx.list.length >> 1;
      boxes.splice(bi, 1, box(bx.list.slice(0, mid)), box(bx.list.slice(mid)));
    }
    let centers = boxes.map(function (bx) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < bx.list.length; k++) { const i = bx.list[k]; r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; }
      const m = bx.list.length || 1; return [r / m, g / m, b / m];
    });
    const Kc = centers.length;
    const index = new Int32Array(n).fill(-1);
    for (let pass = 0; pass < 5; pass++) {
      const sr = new Float64Array(Kc), sg = new Float64Array(Kc), sb = new Float64Array(Kc), cnt = new Int32Array(Kc);
      for (let k = 0; k < px.length; k++) {
        const i = px[k], r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        let bd = Infinity, bk = 0;
        for (let c = 0; c < Kc; c++) {
          const dr = r - centers[c][0], dg = g - centers[c][1], db = b - centers[c][2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bd) { bd = d; bk = c; }
        }
        index[i] = bk; sr[bk] += r; sg[bk] += g; sb[bk] += b; cnt[bk]++;
      }
      for (let c = 0; c < Kc; c++) if (cnt[c] > 0) centers[c] = [sr[c] / cnt[c], sg[c] / cnt[c], sb[c] / cnt[c]];
    }
    return { index: index, palette: centers };
  }

  // Multi-source BFS: give every ink pixel the color of its nearest painted
  // neighbor. A line between two DIFFERENT colors splits down the middle (the
  // boundary is preserved); a line inside ONE color closes up. So no black
  // regions are ever created — the ink overlay redraws the detail on top.
  function fillInk(index, ink, W, H) {
    const n = W * H;
    const out = new Int32Array(n); out.set(index);
    const filled = new Uint8Array(n);
    let frontier = [];
    for (let i = 0; i < n; i++) { if (!ink[i]) { filled[i] = 1; frontier.push(i); } }
    while (frontier.length) {
      const next = [];
      for (let k = 0; k < frontier.length; k++) {
        const p = frontier[k], x = p % W, c = out[p];
        if (x + 1 < W && !filled[p + 1]) { filled[p + 1] = 1; out[p + 1] = c; next.push(p + 1); }
        if (x - 1 >= 0 && !filled[p - 1]) { filled[p - 1] = 1; out[p - 1] = c; next.push(p - 1); }
        if (p + W < n && !filled[p + W]) { filled[p + W] = 1; out[p + W] = c; next.push(p + W); }
        if (p - W >= 0 && !filled[p - W]) { filled[p - W] = 1; out[p - W] = c; next.push(p - W); }
      }
      frontier = next;
    }
    return out;
  }

  // Dissolve the thin fringe/AA bands and specks that cling to the ink lines by
  // folding them into their most COLOR-SIMILAR neighbour. Two kinds of target:
  //   • small blobs (area < softArea)      -> merge if ΔE < softDE (strict);
  //   • thin bands (mean width < softThick, even if long) -> merge if ΔE < softDE2
  //     (looser: a thin colored band is almost always an artifact, not a feature).
  // Genuine features (flower, sheep, sun) are wide blobs of a distinct color, so
  // they fail both tests and stay. Merging into the MOST SIMILAR neighbour (not
  // just the biggest border) keeps colors honest. A few passes let it converge.
  function absorbFringe(labels, colorIdx, count, palette, W, H, softArea, softDE, softThick, softDE2) {
    const lab = palette.map(function (h) { return srgbToLab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)); });
    let curL = labels, curC = Array.prototype.slice.call(colorIdx), curN = count;
    for (let pass = 0; pass < 4; pass++) {
      const parent = new Int32Array(curN); for (let i = 0; i < curN; i++) parent[i] = i;
      const find = function (i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const area = new Float64Array(curN);
      for (let i = 0; i < W * H; i++) area[curL[i]]++;
      const adj = new Map();
      const link = function (a, b) { if (a === b) return; let m = adj.get(a); if (!m) { m = new Map(); adj.set(a, m); } m.set(b, (m.get(b) || 0) + 1); let n2 = adj.get(b); if (!n2) { n2 = new Map(); adj.set(b, n2); } n2.set(a, (n2.get(a) || 0) + 1); };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x, a = curL[p]; if (x + 1 < W) link(a, curL[p + 1]); if (y + 1 < H) link(a, curL[p + W]); }
      // candidate = small OR thin; sort by area so the smallest go first
      const cand = [];
      for (let r = 0; r < curN; r++) {
        const nb = adj.get(r); let perim = 0; if (nb) nb.forEach(function (c) { perim += c; });
        const thin = perim > 0 && (2 * area[r] / perim) < softThick;
        if (area[r] < softArea || thin) cand.push(r);
      }
      cand.sort(function (a, b) { return area[a] - area[b]; });
      let changed = false;
      for (let s = 0; s < cand.length; s++) {
        const r = cand[s]; if (find(r) !== r) continue;
        const nb = adj.get(r); if (!nb) continue;
        let perim = 0; nb.forEach(function (c) { perim += c; });
        const thin = perim > 0 && (2 * area[r] / perim) < softThick;
        const limit = thin ? softDE2 : softDE;
        // pick the most color-similar neighbour
        let best = -1, bestD = 1e9;
        nb.forEach(function (c, other) { const o = find(other); if (o === r) return; const d = deltaE(lab[curC[r]], lab[curC[o]]); if (d < bestD) { bestD = d; best = o; } });
        if (best >= 0 && bestD < limit) { parent[r] = best; changed = true; }
      }
      if (!changed) break;
      const remap = new Int32Array(curN).fill(-1); let nc = 0; const newColor = [];
      for (let i = 0; i < curN; i++) { const r = find(i); if (remap[r] < 0) { remap[r] = nc; newColor[nc] = curC[r]; nc++; } }
      const out = new Int32Array(W * H); for (let i = 0; i < W * H; i++) out[i] = remap[find(curL[i])];
      curL = out; curC = newColor; curN = nc;
    }
    return { labels: curL, colorIndex: curC, count: curN };
  }

  // ---- CLEAN LINE-ART pipeline (for the curated acervo) ------------------
  // The source is already a coloring page: crisp black lines + flat colors, so
  // photo machinery (walls-flood, region-averaging) only hurts. Instead we
  // quantize the flat colors at the PIXEL level, close the ink lines by nearest
  // color, and let same-color connectivity carve the regions. Because a region
  // is defined by its color, one color can never leak into another. Meant to
  // run at HIGH resolution (offline baking).
  function fromLineArt(imageData, opts) {
    opts = opts || {};
    const data = imageData.data, W = imageData.width, H = imageData.height, n = W * H;
    const K = Math.max(2, Math.min(48, opts.colors || 20));
    const darkT = opts.darkT == null ? 95 : opts.darkT;

    // 1) the artist's line art. Two detectors combined:
    //    (a) ridge — thin colored strokes (brown outlines, sun rays);
    //    (b) bold — a dark pixel of ANY hue that lies within a line-WIDTH of a
    //        lighter area, so a thick decorative frame or heavy outline is taken
    //        whole (continuous ink) instead of fracturing into a colorable strip.
    //        A large dark FILL (deep foliage) is wider than the limit and stays
    //        colorable. The distance transform tells a thick line from a blob.
    const inkRidge = lineMask(data, W, H, opts.darkT2 == null ? 110 : opts.darkT2, opts.ridgeT || 10);
    const darkLine = opts.darkLine == null ? 92 : opts.darkLine;
    const dk = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; if (0.299 * r + 0.587 * g + 0.114 * b < darkLine) dk[i] = 1; }
    const dkDT = chamferDT(dk, W, H);
    const rBold = opts.rBold == null ? Math.round(Math.max(W, H) * 0.0125) * 3 : opts.rBold;
    const ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) ink[i] = (inkRidge[i] || (dk[i] && dkDT[i] < rBold)) ? 1 : 0;
    // Widen the line mask a touch ONLY for color assignment: the anti-aliased
    // band hugging each stroke (a few desaturated pixels) is what became a thin
    // grey "contour" region you'd have to paint. Excluding that band from the
    // quantize and letting fillInk hand it to the neighbouring fill dissolves it.
    // The VISIBLE ink stays thin; the backing raster covers any resulting seam.
    let inkMask = ink;
    const grow = opts.inkGrow == null ? 1 : opts.inkGrow;
    for (let g = 0; g < grow; g++) inkMask = dilate1(inkMask, W, H);
    // 2) quantize the painted areas to K flat tones (masked pixels left as -1)
    const q = quantizeMasked(data, W, H, inkMask, K);
    // 3) collapse near-identical tones so one flat fill = one swatch
    const dd = mergeSimilarColors(q.palette, indexToU8(q.index), n, opts.mergeT || 26);
    // 4) close the (widened) line band: each pixel takes its nearest painted
    //    color, so no thin edge-band region survives along the strokes.
    const idx = fillInk(u8ToInt(dd.indices), inkMask, W, H);
    // 5) same-color connectivity -> one region per painted patch
    const cc = connectedComponents(idx, W, H);
    const minArea = Math.max(6, Math.round(n * (opts.minAreaFrac || 0.00006)));
    // thickness floor: fold away only line-THIN regions (1-3px AA slivers), not
    // genuine slender details like fern leaves. Kept small on purpose.
    const minThick = opts.minThick == null ? Math.max(2.5, Math.round(Math.max(W, H) * 0.0026)) : opts.minThick;
    const merged = mergeSmall(cc.labels, cc.regionColor, W, H, minArea, minThick);
    // 6) fold same-color neighbors (fewer tap targets; ink keeps every detail)
    let fold = foldSameColor(merged.labels, merged.regionColor, merged.count, W, H);
    // 6b) adaptive granularity: simple images keep their detail, but a very busy
    //     one (hundreds of tiny targets) gets progressively merged until it's
    //     comfortably tappable — no white specks, no crayon-thin regions.
    const maxRegions = opts.maxRegions || 300;
    let mA = minArea, mT = minThick, guard = 0;
    while (fold.count > maxRegions && guard++ < 6) {
      mA = Math.round(mA * 1.7) + 24; mT += 1.5;
      const m2 = mergeSmall(fold.labels, fold.colorIndex, W, H, mA, mT);
      fold = foldSameColor(m2.labels, m2.regionColor, m2.count, W, H);
    }
    // Lift near-black fills toward a floor luminance (keeping hue) so no painted
    // region is as dark as the contour line — a black fill no longer disappears
    // into the ink. Rich mid-dark colors (trunk, dark green) are left alone.
    const LMIN = opts.minLum == null ? 76 : opts.minLum;
    const palette = dd.palette.map(function (c) {
      let r = c[0], g = c[1], b = c[2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      if (L < LMIN) { const k = LMIN / Math.max(L, 6); r = Math.min(255, r * k); g = Math.min(255, g * k); b = Math.min(255, b * k); }
      return rgbToHex(Math.round(r), Math.round(g), Math.round(b));
    });

    // 6c) de-fringe: merge small regions into a color-similar dominant neighbor,
    //     dissolving the thin bands/specks that cling to the contour lines.
    if (opts.fringe !== false) {
      const softArea = Math.round(n * (opts.fringeAreaFrac || 0.0009));
      const softThick = opts.fringeThick == null ? Math.max(5, Math.round(Math.max(W, H) * 0.006)) : opts.fringeThick;
      fold = absorbFringe(fold.labels, fold.colorIndex, fold.count, palette, W, H, softArea, opts.fringeDE || 30, softThick, opts.fringeDE2 || 55);
    }

    const board = Boards.vectorize({
      labels: fold.labels, gridW: W, gridH: H,
      regionCount: fold.count, regionColor: fold.colorIndex,
      palette: palette, minArea: 2, tile: true,
      tileIters: opts.tileIters, tileEps: opts.tileEps
    });
    // solid line-art as filled vector — crisp at any zoom, full detail. Eroded
    // a touch so the contour reads thin & delicate instead of a heavy black
    // border that a dark fill blends into.
    const inkErode = opts.inkErode == null ? 1 : opts.inkErode;
    const inkThin = inkErode > 0 ? erodeMask(ink, W, H, inkErode) : ink;
    board.inkPath = Boards.inkFill(inkThin, W, H);
    board.inkFilled = true;
    // Backing raster: the flat solution painted straight from the label map, so
    // adjacent colors abut pixel-perfectly (no anti-alias seam like two SVG
    // paths). Drawn UNDER the regions; a painted tile matches it exactly, so any
    // sub-pixel gap between vector tiles shows the correct color, never white.
    if (opts.solution !== false && typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const im = ctx.createImageData(W, H), pd = im.data;
      const rgb = palette.map(function (h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; });
      for (let i = 0; i < n; i++) {
        const c = rgb[fold.colorIndex[fold.labels[i]]] || [200, 200, 200];
        pd[i * 4] = c[0]; pd[i * 4 + 1] = c[1]; pd[i * 4 + 2] = c[2]; pd[i * 4 + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      board.solutionImage = cv.toDataURL('image/png');
    }
    board.id = opts.id || ('img-' + Date.now());
    board.title = opts.title || 'Minha Imagem';
    board.subtitle = board.regions.length + ' regiões · ' + board.palette.length + ' cores';
    return board;
  }

  // ink pixels (index -1) map to palette slot 0 for the dedup pass; they are
  // overwritten by fillInk afterwards, so the placeholder never reaches output.
  function indexToU8(index) {
    const n = index.length, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = index[i] < 0 ? 0 : index[i];
    return out;
  }
  function u8ToInt(u8) {
    const n = u8.length, out = new Int32Array(n);
    for (let i = 0; i < n; i++) out[i] = u8[i];
    return out;
  }

  // ---- full pipeline: ImageData -> board ---------------------------------
  function fromImageData(imageData, opts) {
    opts = opts || {};
    const data = imageData.data, W = imageData.width, H = imageData.height, n = W * H;
    const K = Math.max(2, Math.min(48, opts.colors || 18));
    const maxRegions = opts.maxRegions || 450;
    const s = Math.max(1, Math.round(Math.max(W, H) / 540));

    // A) blur for gradients
    const blur = blurRGB(data, W, H);
    // B1) ink mask (dark seed + ridge + hysteresis for continuous strokes),
    //     then split thin LINE (walls) from thick FILL via distance transform
    let darkT = 100; const df = darkMask(data, W, H, darkT);
    if (df.frac > 0.30) darkT = 80;
    const INK = widenInk(data, W, H, darkT);
    const dt = chamferDT(INK, W, H);
    const rFill = Math.max(3, Math.round(4 * s)) * 3;
    const LINE = new Uint8Array(n); let lineCnt = 0;
    for (let i = 0; i < n; i++) if (INK[i] && dt[i] < rFill) { LINE[i] = 1; lineCnt++; }
    // B2) gradient edges (continuous via hysteresis)
    const E = cannyEdges(blur, W, H);
    // B3) walls = (edges ∪ thin ink), dilated 1px to close gaps
    const wall0 = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (E[i] || LINE[i]) wall0[i] = 1;
    const walls = dilate1(wall0, W, H);
    // C) line-art detector
    const isLineArt = (lineCnt / n) > 0.015;

    // D) flood regions between walls; wall pixels reassigned to nearest region
    const seg = segmentByEdges(walls, W, H);
    // D2) split regions that flooded across a low-contrast boundary
    const labImg = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const c = srgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); labImg[i * 3] = c[0]; labImg[i * 3 + 1] = c[1]; labImg[i * 3 + 2] = c[2]; }
    const sp = splitOversized(seg.labels, seg.count, labImg, walls, W, H);
    // E) edge-aware region merge
    const mg = edgeAwareMerge(sp.labels, sp.count, data, walls, INK, W, H, {
      minArea: Math.max(24, Math.round(n * 0.0009)),
      MERGE_T: isLineArt ? 14 : 16,
      maxRegions: maxRegions
    });
    // F) flat palette from region colors (perceptual clustering)
    const rc = regionColors(data, walls, mg.labels, mg.count, W, H);
    const pal = paletteFromRegions(rc.colors, rc.area, Math.min(30, Math.max(K, 12)), 8);
    // G) ink line-art: reproduce the artist's black strokes AS THEY ARE — trace
    //     a clean dark mask into filled black shapes (no skeleton rebuild, so no
    //     dashes/stray lines). A tighter threshold than the wall INK keeps it to
    //     the actual line work, not shadows.
    const lineMask = darkMask(data, W, H, 110).mask;
    const inkPath = Boards.inkFill(lineMask, W, H);
    // H) fold same-color neighbors -> few large regions (a playable board)
    const fold = foldSameColor(mg.labels, pal.assign, mg.count, W, H);

    const board = Boards.vectorize({
      labels: fold.labels, gridW: W, gridH: H,
      regionCount: fold.count, regionColor: fold.colorIndex,
      palette: pal.palette, minArea: 2, smooth: 2
    });
    board.id = opts.id || ('img-' + Date.now());
    board.title = opts.title || 'Minha Imagem';
    board.subtitle = board.regions.length + ' regiões · ' + board.palette.length + ' cores';
    board.custom = true;
    board.inkPath = inkPath;
    board.inkFilled = true;   // render as filled black shapes, not a stroke
    return board;
  }

  // 1px mask along every region boundary — used to draw outlines for a vector
  // source that has no line layer of its own.
  function boundaryMask(labels, W, H) {
    const n = W * H, m = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, l = labels[i];
      if (x + 1 < W && labels[i + 1] !== l) { m[i] = 1; m[i + 1] = 1; }
      if (y + 1 < H && labels[i + W] !== l) { m[i] = 1; m[i + W] = 1; }
    }
    return m;
  }

  // ---- VECTOR-native path: build a board from a per-pixel palette-index map --
  // The caller (a vector loader) resolves each SVG path to ONE flat color and
  // renders path membership into `idx` (no color quantization, no anti-alias
  // colour slivers). Here we only need to split disjoint patches, drop untappable
  // bits, and vectorize with the exact-tiling smoother. Colours stay EXACT.
  function fromLabelMap(idx, palette, W, H, opts) {
    opts = opts || {};
    const n = W * H;
    const cc = connectedComponents(idx, W, H);
    const minArea = Math.max(6, Math.round(n * (opts.minAreaFrac || 0.00018)));
    const minThick = opts.minThick == null ? Math.max(2.5, Math.round(Math.max(W, H) * 0.003)) : opts.minThick;
    const merged = mergeSmall(cc.labels, cc.regionColor, W, H, minArea, minThick);
    let fold = foldSameColor(merged.labels, merged.regionColor, merged.count, W, H);
    const maxRegions = opts.maxRegions || 320;
    let mA = minArea, mT = minThick, guard = 0;
    while (fold.count > maxRegions && guard++ < 6) {
      mA = Math.round(mA * 1.7) + 24; mT += 1.5;
      const m2 = mergeSmall(fold.labels, fold.colorIndex, W, H, mA, mT);
      fold = foldSameColor(m2.labels, m2.regionColor, m2.count, W, H);
    }
    const board = Boards.vectorize({
      labels: fold.labels, gridW: W, gridH: H,
      regionCount: fold.count, regionColor: fold.colorIndex,
      palette: palette, minArea: 2, tile: true
    });
    if (opts.outline !== false) {
      board.inkPath = Boards.inkFill(boundaryMask(fold.labels, W, H), W, H);
      board.inkFilled = true;
    }
    if (opts.backing !== false && typeof document !== 'undefined') {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'), im = ctx.createImageData(W, H), pd = im.data;
      const rgb = palette.map(function (h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; });
      for (let i = 0; i < n; i++) { const c = rgb[fold.colorIndex[fold.labels[i]]] || [200, 200, 200]; pd[i * 4] = c[0]; pd[i * 4 + 1] = c[1]; pd[i * 4 + 2] = c[2]; pd[i * 4 + 3] = 255; }
      ctx.putImageData(im, 0, 0); board.solutionImage = cv.toDataURL('image/png');
    }
    board.id = opts.id || ('svg-' + Date.now());
    board.title = opts.title || 'Vetor';
    board.subtitle = board.regions.length + ' regiões · ' + board.palette.length + ' cores';
    return board;
  }

  // ---- VECTOR import at runtime: SVG text -> playable board ----------------
  // Resolve each shape to ONE flat color (its MEAN displayed color, so gradients
  // and opacity are handled exactly as drawn), render shape membership crisply
  // to get disjoint regions that respect stacking, then hand off to fromLabelMap.
  // Async (SVG rasterizes via an <img>). Returns a Promise<board>.
  function fromSVG(svgText, opts) {
    opts = opts || {};
    const LONG = opts.long || 1400;
    return new Promise(function (resolve, reject) {
      try {
        const parseDoc = function () { return new DOMParser().parseFromString(svgText, 'image/svg+xml'); };
        const d0 = parseDoc();
        if (d0.querySelector('parsererror')) { reject(new Error('SVG inválido')); return; }
        const root = d0.documentElement;
        if (!root || root.tagName.toLowerCase() !== 'svg') { reject(new Error('Isso não parece um SVG')); return; }
        const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        let VW = vb.length === 4 ? vb[2] : 0, VH = vb.length === 4 ? vb[3] : 0;
        if (!VW || !VH) { VW = parseFloat(root.getAttribute('width')) || 1000; VH = parseFloat(root.getAttribute('height')) || 1000; }
        const scale = LONG / Math.max(VW, VH);
        const W = Math.max(1, Math.round(VW * scale)), H = Math.max(1, Math.round(VH * scale));

        function renderEl(elm) {
          return new Promise(function (res, rej) {
            elm.setAttribute('width', W); elm.setAttribute('height', H);
            if (!(elm.getAttribute('viewBox') || '').trim()) elm.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
            const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(elm));
            const img = new Image();
            img.onload = function () {
              const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
              const cx = cv.getContext('2d', { willReadFrequently: true });
              cx.imageSmoothingEnabled = false; cx.drawImage(img, 0, 0, W, H);
              res(cx.getImageData(0, 0, W, H).data);
            };
            img.onerror = function () { rej(new Error('Não consegui renderizar o SVG')); };
            img.src = url;
          });
        }

        const d1 = parseDoc();
        const shapes = Array.prototype.slice.call(d1.documentElement.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line'));
        if (!shapes.length) { reject(new Error('O SVG não tem formas para colorir')); return; }
        shapes.forEach(function (p, i) {
          const c = 'rgb(' + (i & 255) + ',' + ((i >> 8) & 255) + ',0)';
          p.style.setProperty('fill', c, 'important'); p.style.setProperty('stroke', c, 'important');
          p.style.setProperty('opacity', '1', 'important'); p.style.setProperty('fill-opacity', '1', 'important'); p.style.setProperty('stroke-opacity', '1', 'important');
          p.removeAttribute('filter');
        });
        d1.documentElement.setAttribute('shape-rendering', 'crispEdges');

        Promise.all([renderEl(root), renderEl(d1.documentElement)]).then(function (arr) {
          const colorData = arr[0], idData = arr[1], n = W * H, nS = shapes.length;
          const id = new Int32Array(n);
          const pxOf = new Array(nS); for (let k = 0; k < nS; k++) pxOf[k] = [];
          for (let i = 0; i < n; i++) {
            const v = idData[i * 4] + idData[i * 4 + 1] * 256;
            id[i] = v < nS ? v : -1;
            if (id[i] >= 0) pxOf[id[i]].push(i);
          }
          // Gradient BANDING: a shape whose fill spans a wide luminance range is a
          // gradient (sky, mountain face). Split it into a few color STEPS along
          // that range instead of one muddy average — so the flat/played board
          // shows the gradient (as bands) and the palette is richer. Flat shapes
          // stay one color. (Reveal-on-paint still smooths it back to the original.)
          const lum = function (i) { return 0.299 * colorData[i * 4] + 0.587 * colorData[i * 4 + 1] + 0.114 * colorData[i * 4 + 2]; };
          const bandTH = opts.bandRange == null ? 40 : opts.bandRange;
          const rawCols = []; const pixRaw = new Int32Array(n).fill(-1);
          for (let k = 0; k < nS; k++) {
            const px = pxOf[k]; if (!px.length) continue;
            let minL = 1e9, maxL = -1e9;
            for (let t = 0; t < px.length; t++) { const L = lum(px[t]); if (L < minL) minL = L; if (L > maxL) maxL = L; }
            const range = maxL - minL;
            const bands = (opts.bands !== false && range > bandTH && px.length > 150) ? Math.min(4, 2 + Math.floor((range - bandTH) / 45)) : 1;
            if (bands <= 1) {
              let r = 0, g = 0, b = 0; for (let t = 0; t < px.length; t++) { const i = px[t]; r += colorData[i * 4]; g += colorData[i * 4 + 1]; b += colorData[i * 4 + 2]; }
              const cid = rawCols.length; rawCols.push([r / px.length, g / px.length, b / px.length]);
              for (let t = 0; t < px.length; t++) pixRaw[px[t]] = cid;
            } else {
              const base = rawCols.length, sR = new Float64Array(bands), sG = new Float64Array(bands), sB = new Float64Array(bands), ct = new Int32Array(bands);
              const bandOf = function (L) { let bi = Math.floor((L - minL) / range * bands); if (bi < 0) bi = 0; if (bi >= bands) bi = bands - 1; return bi; };
              for (let t = 0; t < px.length; t++) { const i = px[t], bi = bandOf(lum(i)); sR[bi] += colorData[i * 4]; sG[bi] += colorData[i * 4 + 1]; sB[bi] += colorData[i * 4 + 2]; ct[bi]++; }
              for (let bnd = 0; bnd < bands; bnd++) { const m = ct[bnd] || 1; rawCols.push([sR[bnd] / m, sG[bnd] / m, sB[bnd] / m]); }
              for (let t = 0; t < px.length; t++) pixRaw[px[t]] = base + bandOf(lum(px[t]));
            }
          }
          // dedup the band/flat colors into a compact palette
          const palette = [], remap = [], thr2 = (opts.mergeT || 20) * (opts.mergeT || 20);
          for (let k = 0; k < rawCols.length; k++) {
            const c = rawCols[k]; let best = -1, bd = 1e18;
            for (let j = 0; j < palette.length; j++) { const p = palette[j], dr = p[0] - c[0], dg = p[1] - c[1], db = p[2] - c[2], dd = dr * dr + dg * dg + db * db; if (dd < bd) { bd = dd; best = j; } }
            if (best >= 0 && bd < thr2) remap[k] = best; else { remap[k] = palette.length; palette.push(c); }
          }
          if (!palette.length) palette.push([200, 200, 200]);
          const palHex = palette.map(function (c) { return rgbToHex(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])); });
          const idx = new Int32Array(n);
          for (let i = 0; i < n; i++) { idx[i] = pixRaw[i] >= 0 ? remap[pixRaw[i]] : 0; }
          // Reveal-on-paint keeps the gradients: no flat backing; instead the
          // ORIGINAL rendered colors become the paint source for each region.
          const wantReveal = opts.reveal !== false;
          const board = fromLabelMap(idx, palHex, W, H, wantReveal ? Object.assign({}, opts, { backing: false }) : opts);
          if (wantReveal) {
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const cx = cv.getContext('2d'); const im2 = cx.createImageData(W, H);
            im2.data.set(colorData); cx.putImageData(im2, 0, 0);
            board.revealImage = cv.toDataURL('image/png');
          }
          resolve(board);
        }).catch(reject);
      } catch (e) { reject(e); }
    });
  }

  const Pipeline = {
    fromImageData: fromImageData,
    fromLineArt: fromLineArt,
    fromLabelMap: fromLabelMap,
    fromSVG: fromSVG,
    quantize: quantize,
    connectedComponents: connectedComponents,
    mergeSmall: mergeSmall,
    edgeMask: edgeMask,
    segmentByEdges: segmentByEdges,
    rgbToHex: rgbToHex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pipeline;
  global.Pipeline = Pipeline;
})(typeof window !== 'undefined' ? window : globalThis);
