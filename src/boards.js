/*
 * boards.js — turn a label map (each grid cell belongs to exactly one region)
 * into DISJOINT vector regions with traced SVG outlines, centroids and areas.
 *
 * Two producers feed the same vectorizer:
 *   - process(level)         : hand-authored shape stacks (levels.js) are
 *                              rasterized (topmost shape wins) into a label map.
 *   - Boards.vectorize(...)  : the image pipeline (pipeline.js) hands us a label
 *                              map straight from pixels.
 *
 * Pure module (no DOM) so it runs in the browser and under Node for testing.
 */
(function (global) {
  'use strict';

  // ---- geometry in viewBox units (0..100 across the width) ----------------
  function parsePolygon(str) {
    return str.trim().split(/\s+/).map(function (p) {
      const c = p.split(','); return [+c[0], +c[1]];
    });
  }

  function regionBBox(r) {
    const g = r.geo;
    switch (r.shape) {
      case 'rect':    return { x0: +g.x, y0: +g.y, x1: +g.x + +g.width, y1: +g.y + +g.height };
      case 'circle':  return { x0: +g.cx - +g.r, y0: +g.cy - +g.r, x1: +g.cx + +g.r, y1: +g.cy + +g.r };
      case 'ellipse': return { x0: +g.cx - +g.rx, y0: +g.cy - +g.ry, x1: +g.cx + +g.rx, y1: +g.cy + +g.ry };
      case 'polygon': {
        const pts = r._pts || (r._pts = parsePolygon(g.points));
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(function (p) {
          x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
          x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
        });
        return { x0: x0, y0: y0, x1: x1, y1: y1 };
      }
      default: return { x0: 0, y0: 0, x1: 100, y1: 100 };
    }
  }

  function contains(r, x, y) {
    const g = r.geo;
    switch (r.shape) {
      case 'rect':
        return x >= +g.x && x <= +g.x + +g.width && y >= +g.y && y <= +g.y + +g.height;
      case 'circle': {
        const dx = x - +g.cx, dy = y - +g.cy;
        return dx * dx + dy * dy <= +g.r * +g.r;
      }
      case 'ellipse': {
        const dx = (x - +g.cx) / +g.rx, dy = (y - +g.cy) / +g.ry;
        return dx * dx + dy * dy <= 1;
      }
      case 'polygon': {
        const pts = r._pts || (r._pts = parsePolygon(g.points));
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
          if (((yi > y) !== (yj > y)) &&
              (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      }
      default: return false;
    }
  }

  // ---- rasterize a shape stack into a square label map -------------------
  function rasterize(level, N) {
    const labels = new Int32Array(N * N).fill(-1);
    const S = 100 / N;
    level.regions.forEach(function (r, idx) {
      const bb = regionBBox(r);
      const gx0 = Math.max(0, Math.floor(bb.x0 / S));
      const gx1 = Math.min(N - 1, Math.ceil(bb.x1 / S));
      const gy0 = Math.max(0, Math.floor(bb.y0 / S));
      const gy1 = Math.min(N - 1, Math.ceil(bb.y1 / S));
      for (let gy = gy0; gy <= gy1; gy++) {
        const uy = (gy + 0.5) * S;
        for (let gx = gx0; gx <= gx1; gx++) {
          const ux = (gx + 0.5) * S;
          if (contains(r, ux, uy)) labels[gy * N + gx] = idx;
        }
      }
    });
    return labels;
  }

  // ---- per-region area + centroid (grid W x H, uniform scale S) -----------
  function regionMeta(labels, W, H, regionCount, S) {
    const area = new Int32Array(regionCount);
    const sx = new Float64Array(regionCount);
    const sy = new Float64Array(regionCount);
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const id = labels[gy * W + gx];
        if (id < 0) continue;
        area[id]++; sx[id] += gx + 0.5; sy[id] += gy + 0.5;
      }
    }
    const meta = [];
    for (let i = 0; i < regionCount; i++) {
      meta[i] = area[i] > 0
        ? { area: area[i], cx: (sx[i] / area[i]) * S, cy: (sy[i] / area[i]) * S }
        : { area: 0, cx: 0, cy: 0 };
    }
    return meta;
  }

  // ---- trace region boundaries into SVG path data ------------------------
  function edgeKey(x, y) { return x * 100003 + y; }

  function collectEdges(labels, W, H) {
    const byRegion = {}; // regionId -> array of [ [ax,ay],[bx,by] ]
    function push(id, a, b) {
      if (id < 0) return;
      (byRegion[id] || (byRegion[id] = [])).push([a, b]);
    }
    for (let gy = 0; gy < H; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const id = labels[gy * W + gx];
        const right = gx + 1 < W ? labels[gy * W + gx + 1] : -1;
        const down = gy + 1 < H ? labels[(gy + 1) * W + gx] : -1;
        if (id !== right) {
          const a = [gx + 1, gy], b = [gx + 1, gy + 1];
          push(id, a, b); push(right, a, b);
        }
        if (id !== down) {
          const a = [gx, gy + 1], b = [gx + 1, gy + 1];
          push(id, a, b); push(down, a, b);
        }
        if (gx === 0 && id >= 0) push(id, [0, gy], [0, gy + 1]);
        if (gy === 0 && id >= 0) push(id, [gx, 0], [gx + 1, 0]);
      }
    }
    return byRegion;
  }

  // Chaikin corner-cutting: turns a stair-stepped grid outline into a smooth
  // closed curve. Vector output stays crisp at any resolution (Full HD+).
  function chaikin(loop, iterations) {
    let pts = loop;
    for (let it = 0; it < iterations; it++) {
      const out = [];
      const m = pts.length;
      for (let i = 0; i < m; i++) {
        const p = pts[i], q = pts[(i + 1) % m];
        out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25]);
        out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
      }
      pts = out;
    }
    return pts;
  }

  // Douglas-Peucker: drops points while keeping the point of largest deviation
  // at each step, so smooth curves stay smooth with far fewer points.
  function simplifyDP(points, eps) {
    const n = points.length;
    if (n < 4) return points;
    const keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const seg = stack.pop(), s = seg[0], e = seg[1];
      const ax = points[s][0], ay = points[s][1];
      const dx = points[e][0] - ax, dy = points[e][1] - ay;
      const len = Math.hypot(dx, dy) || 1;
      let maxD = -1, idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
    return out;
  }

  function stitch(edges, S, smooth) {
    const adj = new Map();
    const seen = new Set();
    function addDir(a, b) {
      const k = edgeKey(a[0], a[1]);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(b);
    }
    edges.forEach(function (e) {
      const a = e[0], b = e[1];
      const uk = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
        ? edgeKey(a[0], a[1]) + ':' + edgeKey(b[0], b[1])
        : edgeKey(b[0], b[1]) + ':' + edgeKey(a[0], a[1]);
      if (seen.has(uk)) return;
      seen.add(uk);
      addDir(a, b); addDir(b, a);
    });

    const usedEdge = new Set();
    function edgeId(ax, ay, bx, by) {
      const ka = edgeKey(ax, ay), kb = edgeKey(bx, by);
      return ka < kb ? ka + ':' + kb : kb + ':' + ka;
    }

    const loops = [];
    adj.forEach(function (_neighbors, startKey) {
      const sx = Math.floor(startKey / 100003), sy = startKey % 100003;
      let curX = sx, curY = sy;
      let started = false;
      let loop = null;
      while (true) {
        const k = edgeKey(curX, curY);
        const neighbors = adj.get(k) || [];
        let next = null;
        for (let i = 0; i < neighbors.length; i++) {
          const nb = neighbors[i];
          if (!usedEdge.has(edgeId(curX, curY, nb[0], nb[1]))) { next = nb; break; }
        }
        if (!next) break;
        if (!started) { started = true; loop = [[curX, curY]]; }
        usedEdge.add(edgeId(curX, curY, next[0], next[1]));
        loop.push([next[0], next[1]]);
        curX = next[0]; curY = next[1];
        if (curX === sx && curY === sy) break;
      }
      if (loop && loop.length > 3) loops.push(simplify(loop));
    });

    return loops.map(function (loop) {
      let pts = loop;
      if (smooth) {
        // drop the duplicated closing vertex so Chaikin treats it as a clean loop
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
          pts = pts.slice(0, -1);
        }
        // Clean the staircase noise first; then a SINGLE Chaikin pass only if the
        // shape is actually curved — straight architectural edges stay straight
        // (removes the wavy look) and the ink centerline can match the fill edge.
        pts = simplifyDP(pts, 0.8);
        if (pts.length > 5) pts = simplifyDP(chaikin(pts, 1), 0.3);
      }
      return pts.map(function (p, i) {
        const x = (p[0] * S).toFixed(2), y = (p[1] * S).toFixed(2);
        return (i === 0 ? 'M' : 'L') + x + ',' + y;
      }).join('') + 'Z';
    }).join('');
  }

  function simplify(loop) {
    const out = [];
    for (let i = 0; i < loop.length; i++) {
      const prev = out[out.length - 1];
      const cur = loop[i];
      const next = loop[(i + 1) % loop.length];
      if (prev) {
        const d1x = cur[0] - prev[0], d1y = cur[1] - prev[1];
        const d2x = next[0] - cur[0], d2y = next[1] - cur[1];
        if (d1x * d2y - d1y * d2x === 0 &&
            Math.sign(d1x) === Math.sign(d2x) && Math.sign(d1y) === Math.sign(d2y)) {
          continue;
        }
      }
      out.push(cur);
    }
    return out;
  }

  // Zhang-Suen thinning: reduce the ink mask (2-4px strokes) to a 1px centerline
  // skeleton, so we can trace the artist's actual strokes (open or closed).
  function thinSkeleton(mask, W, H) {
    const img = Uint8Array.from(mask);
    const clear = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        clear.length = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!img[i]) continue;
          const p2 = img[i - W], p3 = img[i - W + 1], p4 = img[i + 1], p5 = img[i + W + 1],
                p6 = img[i + W], p7 = img[i + W - 1], p8 = img[i - 1], p9 = img[i - W - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0; for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
          else { if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue; }
          clear.push(i);
        }
        if (clear.length) { changed = true; for (let k = 0; k < clear.length; k++) img[clear[k]] = 0; }
      }
    }
    return img;
  }

  // ---- ink line-art as FILLED shapes -------------------------------------
  // For clean line-art the black strokes are already perfect — don't rebuild
  // them. Trace the ink mask itself as a filled black shape (outer outline plus
  // holes), reproducing the artist's exact strokes and thickness. No skeleton,
  // no dashes, no stray diagonals. Rendered with fill-rule:evenodd.
  function inkFill(ink, W, H) {
    const S = 100 / W;
    const labels = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) labels[i] = ink[i] ? 0 : -1;
    const edges = collectEdges(labels, W, H);
    return stitch(edges[0] || [], S, 1);
  }

  // ---- ink line-art: trace the ink skeleton into a bold vector stroke path ---
  // Skeletonize the ink mask, then walk the 1px centerlines into long continuous
  // polylines (through junctions, straightest turn) and smooth them. Captures
  // every stroke — open detail lines included — regardless of region merging.
  function dilate8(m, W, H) {
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

  function inkArcs(ink, W, H) {
    const S = 100 / W;
    // close small gaps (dilate once) so broken strokes reconnect, then thin to 1px
    const sk = thinSkeleton(dilate8(ink, W, H), W, H);
    const used = new Set();
    function eId(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
    function nbrs(i) {
      const x = i % W, y = (i / W) | 0, r = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx; if (sk[q]) r.push(q);
      }
      return r;
    }
    function walk(start) {
      let cur = start, pdx = 0, pdy = 0; const chain = [start];
      while (true) {
        const ns = nbrs(cur); let best = -1, bestScore = -2;
        for (let k = 0; k < ns.length; k++) {
          const nb = ns[k]; if (used.has(eId(cur, nb))) continue;
          let dx = (nb % W) - (cur % W), dy = ((nb / W) | 0) - ((cur / W) | 0);
          const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
          const score = (pdx || pdy) ? dx * pdx + dy * pdy : 1;
          if (score > bestScore) { bestScore = score; best = nb; }
        }
        if (best < 0) break;
        used.add(eId(cur, best));
        chain.push(best);
        pdx = (best % W) - (cur % W); pdy = ((best / W) | 0) - ((cur / W) | 0);
        const l = Math.hypot(pdx, pdy) || 1; pdx /= l; pdy /= l;
        cur = best;
      }
      return chain;
    }
    const out = [];
    function emit(chain) {
      if (chain.length < 4) return;                      // drop tiny specks
      let pts = chain.map(function (i) { return [i % W, (i / W) | 0]; });
      pts = simplifyDP(pts, 0.8);
      if (pts.length > 4) pts = simplifyDP(chaikin(pts, 1), 0.3);
      out.push(pts.map(function (p, k) {
        return (k === 0 ? 'M' : 'L') + (p[0] * S).toFixed(2) + ',' + (p[1] * S).toFixed(2);
      }).join(''));
    }
    // start at endpoints/junctions (degree != 2), then leftover loops
    const starts = [];
    for (let i = 0; i < W * H; i++) if (sk[i]) { const d = nbrs(i).length; if (d !== 2) starts.push(i); }
    for (let s = 0; s < starts.length; s++) {
      let go = true;
      while (go) {
        const ns = nbrs(starts[s]); let has = false;
        for (let k = 0; k < ns.length; k++) if (!used.has(eId(starts[s], ns[k]))) { has = true; break; }
        if (!has) { go = false; break; }
        emit(walk(starts[s]));
      }
    }
    for (let i = 0; i < W * H; i++) if (sk[i]) {
      const ns = nbrs(i);
      for (let k = 0; k < ns.length; k++) if (!used.has(eId(i, ns[k]))) { emit(walk(i)); break; }
    }
    return out.join('');
  }

  // ---- exact-tiling smoother ---------------------------------------------
  // Smoothing each region's outline independently makes a SHARED boundary come
  // out slightly different for its two regions → hairline gaps (white specks
  // when painted) and overlaps. Here we build ONE global graph of boundary
  // vertices and smooth + decimate each vertex a SINGLE time, so every region
  // that touches it uses the identical point. Result: regions tile perfectly —
  // no gaps to hide, so the fill needs no dilation that would bleed past the ink.
  function buildSharedSmoother(labels, W, H, S, iters, dropEps) {
    const K = 100003;
    const nbr = new Map();                         // vkey -> [vkey,...]
    function link(ax, ay, bx, by) {
      const ka = ax * K + ay, kb = bx * K + by;
      let la = nbr.get(ka); if (!la) { la = []; nbr.set(ka, la); } if (la.indexOf(kb) < 0) la.push(kb);
      let lb = nbr.get(kb); if (!lb) { lb = []; nbr.set(kb, lb); } if (lb.indexOf(ka) < 0) lb.push(ka);
    }
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const id = labels[gy * W + gx];
      const right = gx + 1 < W ? labels[gy * W + gx + 1] : -1;
      const down = gy + 1 < H ? labels[(gy + 1) * W + gx] : -1;
      if (id !== right && (id >= 0 || right >= 0)) link(gx + 1, gy, gx + 1, gy + 1);
      if (id !== down && (id >= 0 || down >= 0)) link(gx, gy + 1, gx + 1, gy + 1);
      if (gx === 0 && id >= 0) link(0, gy, 0, gy + 1);
      if (gy === 0 && id >= 0) link(gx, 0, gx + 1, 0);
    }
    let pos = new Map();
    nbr.forEach(function (_l, k) { pos.set(k, [Math.floor(k / K), k % K]); });
    function isCorner(k) { const x = Math.floor(k / K), y = k % K; return (x === 0 || x === W) && (y === 0 || y === H); }
    function isNode(k) { return nbr.get(k).length !== 2 || isCorner(k); }
    // Laplacian rounding — junctions & image corners stay put (shared anchors)
    for (let it = 0; it < iters; it++) {
      const np = new Map();
      nbr.forEach(function (l, k) {
        const c = pos.get(k);
        if (isNode(k)) { np.set(k, c); return; }
        const a = pos.get(l[0]), b = pos.get(l[1]);
        np.set(k, [(a[0] + b[0]) * 0.25 + c[0] * 0.5, (a[1] + b[1]) * 0.25 + c[1] * 0.5]);
      });
      pos = np;
    }
    // Decimate per ARC (a chain of degree-2 vertices between two junction nodes)
    // with Douglas-Peucker on the smoothed positions. Because an arc is shared by
    // its two regions and DP is direction-symmetric, both keep the identical
    // subset → exact tiling. DP (global over the arc, unlike a local test) cleanly
    // collapses long straight diagonals without ever degenerating a region.
    const keep = new Map();
    nbr.forEach(function (_l, k) { keep.set(k, isNode(k)); });
    function dpArc(arc) {
      const m = arc.length; if (m < 3) { for (let i = 0; i < m; i++) keep.set(arc[i], true); return; }
      const pts = arc.map(function (k) { return pos.get(k); });
      const kept = new Uint8Array(m); kept[0] = 1; kept[m - 1] = 1;
      const stack = [[0, m - 1]];
      while (stack.length) {
        const seg = stack.pop(), s = seg[0], e = seg[1];
        const ax = pts[s][0], ay = pts[s][1], dx = pts[e][0] - ax, dy = pts[e][1] - ay, len = Math.hypot(dx, dy) || 1;
        let md = -1, idx = -1;
        for (let i = s + 1; i < e; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len; if (d > md) { md = d; idx = i; } }
        if (md > dropEps && idx > 0) { kept[idx] = 1; stack.push([s, idx], [idx, e]); }
      }
      for (let i = 0; i < m; i++) if (kept[i]) keep.set(arc[i], true);
    }
    const usedE = new Set();
    function ek(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
    // arcs starting at nodes
    nbr.forEach(function (l, k) {
      if (!isNode(k)) return;
      for (let j = 0; j < l.length; j++) {
        let prev = k, cur = l[j];
        if (usedE.has(ek(prev, cur))) continue;
        const arc = [prev]; usedE.add(ek(prev, cur)); arc.push(cur);
        while (!isNode(cur)) {
          const nn = nbr.get(cur), next = nn[0] === prev ? nn[1] : nn[0];
          usedE.add(ek(cur, next)); arc.push(next); prev = cur; cur = next;
        }
        dpArc(arc);
      }
    });
    // pure loops (no node on them): anchor two opposite points, then DP
    nbr.forEach(function (l, k) {
      for (let j = 0; j < l.length; j++) {
        let prev = k, cur = l[j];
        if (usedE.has(ek(prev, cur))) continue;
        const arc = [prev]; usedE.add(ek(prev, cur)); arc.push(cur);
        while (cur !== k) {
          const nn = nbr.get(cur), next = nn[0] === prev ? nn[1] : nn[0];
          usedE.add(ek(cur, next)); arc.push(next); prev = cur; cur = next;
        }
        // split the closed loop at two opposite anchors so each half DPs with
        // distinct endpoints (a single degenerate chord would keep nothing)
        const mid = (arc.length / 2) | 0;
        keep.set(arc[0], true); keep.set(arc[mid], true);
        dpArc(arc.slice(0, mid + 1)); dpArc(arc.slice(mid));
      }
    });
    // trace a region's raw grid loops, then emit through the shared pos + keep
    function regionPath(regEdges) {
      const adj = new Map(), seen = new Set();
      function addDir(a, b) { const k = edgeKey(a[0], a[1]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(b); }
      regEdges.forEach(function (e) {
        const a = e[0], b = e[1];
        const uk = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
          ? edgeKey(a[0], a[1]) + ':' + edgeKey(b[0], b[1])
          : edgeKey(b[0], b[1]) + ':' + edgeKey(a[0], a[1]);
        if (seen.has(uk)) return; seen.add(uk); addDir(a, b); addDir(b, a);
      });
      const usedEdge = new Set();
      function eid(ax, ay, bx, by) { const ka = edgeKey(ax, ay), kb = edgeKey(bx, by); return ka < kb ? ka + ':' + kb : kb + ':' + ka; }
      let out = '';
      adj.forEach(function (_n, startKey) {
        const sx = Math.floor(startKey / K), sy = startKey % K;
        let cx = sx, cy = sy, started = false, loop = null;
        while (true) {
          const neighbors = adj.get(edgeKey(cx, cy)) || [];
          let next = null;
          for (let i = 0; i < neighbors.length; i++) { const nb = neighbors[i]; if (!usedEdge.has(eid(cx, cy, nb[0], nb[1]))) { next = nb; break; } }
          if (!next) break;
          if (!started) { started = true; loop = [[cx, cy]]; }
          usedEdge.add(eid(cx, cy, next[0], next[1]));
          loop.push([next[0], next[1]]);
          cx = next[0]; cy = next[1];
          if (cx === sx && cy === sy) break;
        }
        if (!loop || loop.length < 4) return;
        let d = '', first = true;
        for (let i = 0; i < loop.length; i++) {
          const vk = loop[i][0] * K + loop[i][1];
          if (i < loop.length - 1 && !keep.get(vk)) continue;   // shared decimation
          const p = pos.get(vk) || loop[i];
          d += (first ? 'M' : 'L') + (p[0] * S).toFixed(1) + ',' + (p[1] * S).toFixed(1);
          first = false;
        }
        out += d + 'Z';
      });
      return out;
    }
    return { regionPath: regionPath };
  }

  // ---- shared vectorizer -------------------------------------------------
  // labels: Int32Array(W*H) of region ids (0..regionCount-1) or -1.
  // regionColor: color index per region id. palette: hex strings.
  function vectorize(o) {
    const W = o.gridW, H = o.gridH, S = 100 / W;
    const minArea = o.minArea == null ? 8 : o.minArea;
    const meta = regionMeta(o.labels, W, H, o.regionCount, S);
    const edges = collectEdges(o.labels, W, H);
    const tiled = o.tile ? buildSharedSmoother(o.labels, W, H, S, o.tileIters == null ? 2 : o.tileIters, o.tileEps == null ? 0.75 : o.tileEps) : null;

    // keep only colors that survive, remapped to a compact palette
    const usedColors = [];
    for (let i = 0; i < o.regionCount; i++) {
      if (meta[i].area >= minArea && usedColors.indexOf(o.regionColor[i]) === -1) {
        usedColors.push(o.regionColor[i]);
      }
    }
    usedColors.sort(function (a, b) { return a - b; });
    const palette = usedColors.map(function (ci) { return o.palette[ci]; });
    const remap = {};
    usedColors.forEach(function (ci, k) { remap[ci] = k; });

    const regions = [];
    for (let i = 0; i < o.regionCount; i++) {
      if (meta[i].area < minArea) continue;
      const d = tiled ? tiled.regionPath(edges[i] || []) : stitch(edges[i] || [], S, o.smooth);
      if (!d) continue;
      regions.push({
        shape: 'path',
        geo: { d: d },
        color: remap[o.regionColor[i]],
        lx: +meta[i].cx.toFixed(2),
        ly: +meta[i].cy.toFixed(2),
        area: meta[i].area
      });
    }

    return {
      viewBox: '0 0 100 ' + (H * S).toFixed(2),
      palette: palette,
      regions: regions
    };
  }

  // ---- public: bake a hand-authored level into disjoint vector regions ---
  function process(level, opts) {
    opts = opts || {};
    const N = opts.N || 300;
    const labels = rasterize(level, N);
    const board = vectorize({
      labels: labels, gridW: N, gridH: N,
      regionCount: level.regions.length,
      regionColor: level.regions.map(function (r) { return r.color; }),
      palette: level.palette,
      minArea: opts.minArea || 8
    });
    board.id = level.id;
    board.title = level.title;
    board.subtitle = level.subtitle;
    return board;
  }

  const Boards = { process: process, vectorize: vectorize, rasterize: rasterize, inkArcs: inkArcs, inkFill: inkFill };
  if (typeof module !== 'undefined' && module.exports) module.exports = Boards;
  global.Boards = Boards;
})(typeof window !== 'undefined' ? window : globalThis);
