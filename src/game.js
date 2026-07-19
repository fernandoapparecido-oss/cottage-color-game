/*
 * Cottage Color — color-by-number engine (web prototype).
 *
 * Responsibilities:
 *  - render a level as an interactive SVG (one element per region + number label)
 *  - track the selected palette color and let the player fill matching regions
 *  - pan & pinch-zoom on touch / trackpad
 *  - progress tracking, per-level save to localStorage, completion celebration
 *
 * Monetization hooks (AdMob / rewarded video) are stubbed and marked TODO so the
 * real SDK can be dropped in without touching game logic.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const UNFILLED = '#ececec';       // neutral fill for an un-colored region
  const HATCH_BG = '#eaf2fb';       // hatch base tint (light blue)
  const HATCH_STROKE = '#8fbfe3';   // hatch stripe color (fixed blue)
  const HATCH_TILE = 3.4;           // hatch tile size at zoom 1 (viewBox units)
  const HATCH_STRIPE = 1.7;         // hatch stripe width at zoom 1
  const STORAGE_PREFIX = 'cottagecolor:';

  // ---- DOM refs -----------------------------------------------------------
  const el = {
    viewport:   document.getElementById('viewport'),
    stage:      document.getElementById('stage'),
    palette:    document.getElementById('palette'),
    progressBar:document.getElementById('progress-bar'),
    progressPct:document.getElementById('progress-pct'),
    levelTitle: document.getElementById('level-title'),
    menu:       document.getElementById('menu'),
    menuGrid:   document.getElementById('menu-grid'),
    menuSort:   document.getElementById('menu-sort'),
    menuTodo:   document.getElementById('menu-todo'),
    menuSearch: document.getElementById('menu-search'),
    tutorial:   document.getElementById('tutorial'),
    tutClose:   document.getElementById('tut-close'),
    ggBar:      document.getElementById('gg-bar'),
    ggStreak:   document.getElementById('gg-streak'),
    ggLevel:    document.getElementById('gg-level'),
    rewards:    document.getElementById('rewards'),
    rwLevel:    document.getElementById('rw-level'),
    rwXp:       document.getElementById('rw-xp'),
    rwBar:      document.getElementById('rw-bar'),
    rwStreak:   document.getElementById('rw-streak'),
    rwWeek:     document.getElementById('rw-week'),
    rwAch:      document.getElementById('rw-ach'),
    rwAccountSec: document.getElementById('rw-account-sec'),
    rwAccount:  document.getElementById('rw-account'),
    rwClose:    document.getElementById('rw-close'),
    toast:      document.getElementById('toast'),
    game:       document.getElementById('game'),
    win:        document.getElementById('win'),
    hintBtn:    document.getElementById('hint-btn'),
    seekBtn:    document.getElementById('seek-btn'),
    backBtn:    document.getElementById('back-btn'),
    upload:     document.getElementById('upload'),
    upPreview:  document.getElementById('up-preview'),
    upFile:     document.getElementById('up-file'),
    upTitle:    document.getElementById('up-title'),
    upColors:   document.getElementById('up-colors'),
    upColorsVal:document.getElementById('up-colors-val'),
    upDetail:   document.getElementById('up-detail'),
    upPick:     document.getElementById('up-pick'),
    upPlay:     document.getElementById('up-play'),
    upCancel:   document.getElementById('up-cancel'),
    upStatus:   document.getElementById('up-status'),
    svImport:   document.getElementById('svgimport'),
    svPreview:  document.getElementById('sv-preview'),
    svStatus:   document.getElementById('sv-status'),
    svTitle:    document.getElementById('sv-title'),
    svText:     document.getElementById('sv-text'),
    svFileBtn:  document.getElementById('sv-file-btn'),
    svFile:     document.getElementById('sv-file'),
    svGen:      document.getElementById('sv-gen'),
    svPlay:     document.getElementById('sv-play'),
    svCancel:   document.getElementById('sv-cancel'),
    webSearch:  document.getElementById('websearch'),
    wsQ:        document.getElementById('ws-q'),
    wsSearchBtn:document.getElementById('ws-search'),
    wsStatus:   document.getElementById('ws-status'),
    wsResults:  document.getElementById('ws-results'),
    wsMake:     document.getElementById('ws-make'),
    wsPreview:  document.getElementById('ws-preview'),
    wsMakeStatus:document.getElementById('ws-make-status'),
    wsColors:   document.getElementById('ws-colors'),
    wsColorsVal:document.getElementById('ws-colors-val'),
    wsDetail:   document.getElementById('ws-detail'),
    wsBack:     document.getElementById('ws-back'),
    wsPlayBtn:  document.getElementById('ws-play'),
    wsCancel:   document.getElementById('ws-cancel'),
    winMenuBtn: document.getElementById('win-menu-btn'),
    winShareBtn:document.getElementById('win-share-btn'),
    restartBtn: document.getElementById('restart-btn'),
    boardShare: document.getElementById('boardshare'),
    bsLink:     document.getElementById('bs-link'),
    bsFile:     document.getElementById('bs-file'),
    bsStatus:   document.getElementById('bs-status'),
    bsClose:    document.getElementById('bs-close'),
    boardFile:  document.getElementById('board-file'),
    share:      document.getElementById('share'),
    sharePreview:document.getElementById('share-preview'),
    shareBa:    document.getElementById('share-ba'),
    shareDo:    document.getElementById('share-do'),
    shareDl:    document.getElementById('share-dl'),
    shareClose: document.getElementById('share-close'),
    confetti:   document.getElementById('confetti')
  };

  // ---- Runtime state ------------------------------------------------------
  const state = {
    level: null,        // active level definition
    svg: null,          // the <svg> element in the stage
    regionEls: [],      // SVG shape element per region index
    labelEls: [],       // <text> label element per region index
    filled: [],         // boolean per region index
    selected: 0,        // selected palette color index
    // view transform
    scale: 1, tx: 0, ty: 0
  };

  // =========================================================================
  //  Persistence
  // =========================================================================
  function saveKey(id) { return STORAGE_PREFIX + id; }

  function loadProgress(id) {
    try {
      const raw = localStorage.getItem(saveKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveProgress() {
    if (!state.level) return;
    try {
      const filledIdx = [];
      state.filled.forEach((f, i) => { if (f) filledIdx.push(i); });
      localStorage.setItem(saveKey(state.level.id), JSON.stringify(filledIdx));
    } catch (_) { /* storage full / disabled — non-fatal */ }
    cloudPushSoon();
  }

  function levelCompletion(id, totalRegions) {
    const saved = loadProgress(id);
    if (!saved || !totalRegions) return 0;
    return Math.round((saved.length / totalRegions) * 100);
  }

  // =========================================================================
  //  Board baking (shapes -> disjoint vector regions), cached per level id
  // =========================================================================
  const boardCache = {};
  function getBoard(lvl) {
    if (!boardCache[lvl.id]) boardCache[lvl.id] = window.Boards.process(lvl, { N: 300 });
    return boardCache[lvl.id];
  }

  // Custom boards (photos/SVG/web/imports), persisted as baked board JSON.
  // Stored in IndexedDB (large quota — many boards) with an in-memory cache so
  // the rest of the code stays synchronous; falls back to localStorage when IDB
  // is unavailable (e.g. some private-mode browsers).
  const CUSTOM_KEY = STORAGE_PREFIX + 'custom';
  const MAX_CUSTOM = 50;               // was 6 (localStorage); IDB lifts the wall
  let customCache = null;              // in-memory source of truth for the session
  let idb = null;

  function openIdb() {
    return new Promise(function (resolve) {
      try {
        if (!self.indexedDB) return resolve(null);
        const req = indexedDB.open('cottagecolor', 1);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }
  function idbLoad() {
    return new Promise(function (resolve) {
      if (!idb) return resolve(null);
      try {
        const req = idb.transaction('boards', 'readonly').objectStore('boards').get('list');
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }
  function idbSave(list) {
    if (!idb) return;
    try { idb.transaction('boards', 'readwrite').objectStore('boards').put(list, 'list'); } catch (_) {}
  }

  // Load the custom store into memory once at startup (before the first menu).
  // Migrates any boards from the old localStorage location into IndexedDB.
  function loadCustomStore() {
    return openIdb().then(function (db) {
      idb = db;
      return idbLoad();
    }).then(function (list) {
      if (!list) {
        try { list = JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (_) { list = []; }
        if (idb && list.length) idbSave(list);   // one-time migration from localStorage
      }
      customCache = Array.isArray(list) ? list : [];
    }).catch(function () { customCache = []; });
  }

  function loadCustomBoards() {
    if (customCache) return customCache;
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (_) { return []; }
  }
  function saveCustomBoards(list) {
    customCache = list;
    if (idb) { idbSave(list); return true; }
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); return true; }
    catch (_) { return false; }   // localStorage quota (fallback path only)
  }
  function addCustomBoard(board) {
    if (!board.createdAt) board.createdAt = Date.now();   // import/creation date
    const list = loadCustomBoards().slice();
    list.unshift(board);
    while (list.length > MAX_CUSTOM) list.pop();          // generous soft cap
    if (!saveCustomBoards(list)) {                        // localStorage quota (no IDB)
      while (list.length > 1 && !saveCustomBoards(list)) list.pop();
    }
  }
  function deleteCustomBoard(id) {
    saveCustomBoards(loadCustomBoards().filter(function (b) { return b.id !== id; }));
    try { localStorage.removeItem(saveKey(id)); } catch (_) {}
  }
  function renameCustomBoard(id, title) {
    const list = loadCustomBoards();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i].title = title; break; }
    }
    saveCustomBoards(list);
  }

  // =========================================================================
  //  Menu
  // =========================================================================
  // ---- View state: sort (categorias/nome/recentes), filter, collapsed cats ---
  const MENU_KEY = STORAGE_PREFIX + 'menu';
  const menuState = loadMenuState();

  function loadMenuState() {
    try {
      const s = JSON.parse(localStorage.getItem(MENU_KEY)) || {};
      return { sort: s.sort || 'cat', onlyTodo: !!s.onlyTodo, collapsed: new Set(s.collapsed || []) };
    } catch (_) { return { sort: 'cat', onlyTodo: false, collapsed: new Set() }; }
  }
  function saveMenuState() {
    try {
      localStorage.setItem(MENU_KEY, JSON.stringify({
        sort: menuState.sort, onlyTodo: menuState.onlyTodo, collapsed: Array.from(menuState.collapsed)
      }));
    } catch (_) {}
  }

  // Acervo categories (by board id) and the order categories appear in.
  const CATEGORY = {
    'cur-land': 'Paisagem', 'cur-lake': 'Paisagem', 'cur-lake2': 'Paisagem',
    'cur-kit': 'Casa', 'cur-cot': 'Casa', 'cur-lion': 'Animais'
  };
  const CATEGORY_ORDER = ['Minhas imagens', 'Paisagem', 'Casa', 'Animais', 'Outros', 'Clássicos'];

  // Every playable board with metadata (category, custom?, date, how to start).
  function allBoards() {
    const out = [];
    loadCustomBoards().forEach(function (b) {
      out.push({ board: b, cat: 'Minhas imagens', custom: true, date: b.createdAt || 0, start: function () { startBoard(b); } });
    });
    (window.CURATED || []).forEach(function (b) {
      out.push({ board: b, cat: CATEGORY[b.id] || 'Outros', custom: false, date: 0, start: function () { startBoard(b); } });
    });
    (window.LEVELS || []).forEach(function (lvl) {
      const b = getBoard(lvl);
      out.push({ board: b, cat: 'Clássicos', custom: false, date: 0, start: function () { startLevel(lvl); } });
    });
    return out;
  }

  function pctOf(board) { return levelCompletion(board.id, board.regions.length); }

  // ---- Search box, "continue", "image of the day" ------------------------
  let menuQuery = '';
  const LAST_KEY = STORAGE_PREFIX + 'last';
  const DAILY_KEY = STORAGE_PREFIX + 'daily';
  let dailyFeature = null;   // { kind:'web', theme, hit } | { kind:'acervo', theme, board }

  const DAILY_THEMES = [
    'casa de campo', 'gato', 'flores', 'montanha', 'praia', 'coruja', 'raposa',
    'jardim', 'farol', 'balão de ar quente', 'cachorro', 'pássaro', 'borboleta',
    'árvore', 'lago', 'pôr do sol', 'vaso de flores', 'xícara de chá', 'cogumelo',
    'abelha', 'castelo', 'veleiro', 'cacto', 'floresta', 'lua', 'guarda-chuva',
    'bicicleta', 'sorvete', 'baleia', 'girassol'
  ];
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function todayStr() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function dayNum() { return Math.floor(Date.now() / 86400000); }   // days since epoch

  // Pick today's featured image (deterministic by date) via the web-search proxy;
  // fall back to a rotating acervo board when offline / not configured.
  function initDaily() {
    if (dailyUsedToday()) return Promise.resolve();   // already played today
    const today = todayStr();
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(DAILY_KEY)); } catch (_) {}
    if (cached && cached.date === today && cached.hit) {
      dailyFeature = { kind: 'web', theme: cached.theme, hit: cached.hit };
      return Promise.resolve();
    }
    const theme = DAILY_THEMES[dayNum() % DAILY_THEMES.length];
    if (!proxyReady()) { dailyFallback(theme); return Promise.resolve(); }
    return fetch(proxyBase() + '/search?q=' + encodeURIComponent(theme))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        const hits = (data.hits || []).filter(function (h) { return h.thumb && h.full; });
        if (!hits.length) { dailyFallback(theme); return; }
        const hit = hits[dayNum() % hits.length];   // same image for everyone, that day
        dailyFeature = { kind: 'web', theme: theme, hit: hit };
        try { localStorage.setItem(DAILY_KEY, JSON.stringify({ date: today, theme: theme, hit: hit })); } catch (_) {}
      })
      .catch(function () { dailyFallback(theme); });
  }
  function dailyFallback(theme) {
    const cur = window.CURATED || [];
    if (cur.length) dailyFeature = { kind: 'acervo', theme: theme, board: cur[dayNum() % cur.length] };
  }

  // Once the player has actually played today's image of the day, stop offering
  // it again for the rest of the day.
  const DAILY_USED_KEY = STORAGE_PREFIX + 'dailyUsed';
  function dailyUsedToday() { try { return localStorage.getItem(DAILY_USED_KEY) === todayStr(); } catch (_) { return false; } }
  function markDailyUsed() { try { localStorage.setItem(DAILY_USED_KEY, todayStr()); } catch (_) {} }

  function renderDailyCard() {
    if (!dailyFeature || dailyUsedToday()) return;
    const f = dailyFeature;
    const card = document.createElement('button');
    card.className = 'feature-card daily-card';
    if (f.kind === 'web') {
      const im = document.createElement('img');
      im.className = 'feature-thumb'; im.src = f.hit.thumb; im.alt = '';
      card.appendChild(im);
    } else {
      const t = buildThumbnail(f.board, pctOf(f.board)); t.classList.add('feature-thumb');
      card.appendChild(t);
    }
    const body = document.createElement('span');
    body.className = 'feature-body';
    body.innerHTML = '<span class="feature-kicker">🌅 Imagem do dia</span>' +
      '<span class="feature-title">' + cap(f.kind === 'acervo' ? f.board.title : f.theme) + '</span>';
    card.appendChild(body);
    const go = document.createElement('span'); go.className = 'feature-go'; go.textContent = 'Jogar ›';
    card.appendChild(go);
    card.addEventListener('click', openDaily);
    el.menuGrid.appendChild(card);
  }

  function openDaily() {
    const f = dailyFeature; if (!f) return;
    if (f.kind === 'acervo') { markDailyUsed(); startBoard(f.board); return; }
    // Reuse the web-search preview flow: show the daily image and pick it.
    openWebSearch();
    ws.fromDaily = true;   // so completing it unlocks the "Do dia" achievement
    el.wsQ.value = f.theme;
    el.wsStatus.textContent = 'Imagem do dia: ' + cap(f.theme);
    renderWsResults([f.hit]);
    wsPick(f.hit);
  }

  function renderContinueCard() {
    let lastId = null;
    try { lastId = localStorage.getItem(LAST_KEY); } catch (_) {}
    if (!lastId) return;
    const it = allBoards().filter(function (x) { return x.board.id === lastId; })[0];
    if (!it) return;
    const pct = pctOf(it.board);
    if (pct <= 0 || pct >= 100) return;    // only a board actually in progress
    const card = document.createElement('button');
    card.className = 'feature-card continue-card';
    const t = buildThumbnail(it.board, pct); t.classList.add('feature-thumb');
    card.appendChild(t);
    const body = document.createElement('span');
    body.className = 'feature-body';
    body.innerHTML = '<span class="feature-kicker">▶ Continuar</span>' +
      '<span class="feature-title">' + it.board.title + '</span>' +
      '<span class="feature-sub">' + pct + '% pintado</span>';
    card.appendChild(body);
    const go = document.createElement('span'); go.className = 'feature-go'; go.textContent = 'Continuar ›';
    card.appendChild(go);
    card.addEventListener('click', it.start);
    el.menuGrid.appendChild(card);
  }

  // =========================================================================
  //  Gamification (per device): streak, weekly goal, XP/level, achievements
  // =========================================================================
  const GG_KEY = STORAGE_PREFIX + 'gg';
  const WEEKLY_KEY = STORAGE_PREFIX + 'weekly';

  const PAINTER_LEVELS = [
    { min: 0, name: 'Aprendiz' }, { min: 150, name: 'Pintor' },
    { min: 500, name: 'Artista' }, { min: 1200, name: 'Mestre' },
    { min: 2500, name: 'Grande Mestre' }, { min: 5000, name: 'Lenda' }
  ];
  const ACHIEVEMENTS = [
    { id: 'first', icon: '🎨', title: 'Primeira obra', desc: 'Conclua seu primeiro quadro' },
    { id: 'boards10', icon: '🖼️', title: 'Colecionador', desc: 'Conclua 10 quadros' },
    { id: 'regions1k', icon: '🖌️', title: 'Mão cheia', desc: 'Pinte 1.000 regiões no total' },
    { id: 'daily', icon: '🌅', title: 'Do dia', desc: 'Conclua a imagem do dia' },
    { id: 'share', icon: '📤', title: 'Amigo pintor', desc: 'Envie um quadro para um amigo' },
    { id: 'streak7', icon: '🔥', title: 'Semana quente', desc: 'Jogue 7 dias seguidos' },
    { id: 'streak30', icon: '⚡', title: 'Imparável', desc: 'Jogue 30 dias seguidos' },
    { id: 'perfectweek', icon: '🏆', title: 'Semana perfeita', desc: 'Pinte em todos os 7 dias da semana' }
  ];
  const ACH_BY_ID = {}; ACHIEVEMENTS.forEach(function (a) { ACH_BY_ID[a.id] = a; });

  function normalizeGG(g) {
    g = g || {};
    g.xp = g.xp || 0;
    g.regionsPainted = g.regionsPainted || 0;
    g.boardsCompleted = g.boardsCompleted || 0;
    g.streak = g.streak || 0;
    g.bestStreak = g.bestStreak || 0;
    g.lastActiveDay = (typeof g.lastActiveDay === 'number') ? g.lastActiveDay : null;
    g.freezes = (typeof g.freezes === 'number') ? g.freezes : 1;
    g.week = (g.week && Array.isArray(g.week.days) && g.week.days.length === 7)
      ? g.week : { key: null, days: [false, false, false, false, false, false, false] };
    g.weeklyUnlocked = g.weeklyUnlocked || null;
    g.ach = g.ach || {};
    return g;
  }
  let gg = loadGG();
  let weeklyFeature = null;
  function loadGG() { try { return normalizeGG(JSON.parse(localStorage.getItem(GG_KEY))); } catch (_) { return normalizeGG({}); } }
  function saveGG() { try { localStorage.setItem(GG_KEY, JSON.stringify(gg)); } catch (_) {} cloudPushSoon(); }

  function dayIdx() { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); }
  function weekdayMon() { return (new Date().getDay() + 6) % 7; }   // 0=Mon .. 6=Sun
  function weekStartIdx() { return dayIdx() - weekdayMon(); }

  function levelOf(xp) {
    let idx = 0;
    for (let i = 0; i < PAINTER_LEVELS.length; i++) if (xp >= PAINTER_LEVELS[i].min) idx = i;
    const next = PAINTER_LEVELS[idx + 1] || null;
    return { idx: idx, name: PAINTER_LEVELS[idx].name, min: PAINTER_LEVELS[idx].min, next: next ? next.min : null };
  }

  function toast(msg) {
    if (!el.toast) return;
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    el.toast.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 20);
    setTimeout(function () { t.classList.remove('show'); }, 3200);
    setTimeout(function () { t.remove(); }, 3600);
  }
  function unlock(id) {
    if (gg.ach[id]) return;
    gg.ach[id] = Date.now();
    if (ACH_BY_ID[id]) toast('🏅 Conquista: ' + ACH_BY_ID[id].title);
  }
  function addXp(n) {
    const before = levelOf(gg.xp).idx;
    gg.xp += n;
    if (levelOf(gg.xp).idx > before) toast('⭐ Novo nível: ' + levelOf(gg.xp).name + '!');
  }

  // Mark that the player was active today: advance streak + weekly dots, and
  // fire the weekly reward on a perfect week.
  function markPlayedToday() {
    const today = dayIdx();
    if (gg.lastActiveDay !== today) {
      if (gg.lastActiveDay === today - 1) gg.streak += 1;
      else if (gg.lastActiveDay != null && today - gg.lastActiveDay === 2 && gg.freezes > 0) { gg.freezes -= 1; gg.streak += 1; }
      else gg.streak = 1;
      gg.lastActiveDay = today;
      gg.bestStreak = Math.max(gg.bestStreak, gg.streak);
      if (gg.streak >= 7) unlock('streak7');
      if (gg.streak >= 30) unlock('streak30');
    }
    const wk = String(weekStartIdx());
    if (gg.week.key !== wk) { gg.week = { key: wk, days: [false, false, false, false, false, false, false] }; gg.freezes = Math.max(gg.freezes, 1); }
    gg.week.days[weekdayMon()] = true;
    if (gg.week.days.every(Boolean) && gg.weeklyUnlocked !== wk) {
      gg.weeklyUnlocked = wk;
      unlock('perfectweek');
      addXp(100);
      toast('🏆 Semana perfeita! Quadro da Semana desbloqueado!');
      fetchWeekly();
    }
  }

  // Gameplay hooks
  function gamifyPaint() {
    gg.regionsPainted += 1;
    addXp(1);
    markPlayedToday();
    if (gg.regionsPainted >= 1000) unlock('regions1k');
    saveGG();
  }
  function gamifyComplete(board) {
    gg.boardsCompleted += 1;
    addXp(25);
    unlock('first');
    if (gg.boardsCompleted >= 10) unlock('boards10');
    if (board && board.fromDaily) unlock('daily');
    markPlayedToday();
    saveGG();
  }
  function gamifyShare() { unlock('share'); saveGG(); }

  // The special "Quadro da Semana" image (deterministic by week), shown after a
  // perfect week. Reuses the web-search proxy; silently skips if unavailable.
  const WEEKLY_THEMES = ['jardim encantado', 'vilarejo', 'floresta', 'castelo',
    'farol', 'montanhas nevadas', 'praia tropical', 'céu estrelado'];
  function fetchWeekly() {
    const wk = String(weekStartIdx());
    let cached = null; try { cached = JSON.parse(localStorage.getItem(WEEKLY_KEY)); } catch (_) {}
    if (cached && cached.week === wk && cached.hit) { weeklyFeature = { theme: cached.theme, hit: cached.hit }; buildMenu(); return; }
    if (!proxyReady()) return;
    const wnum = Math.floor(weekStartIdx() / 7);
    const theme = WEEKLY_THEMES[wnum % WEEKLY_THEMES.length];
    fetch(proxyBase() + '/search?q=' + encodeURIComponent(theme))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        const hits = (data.hits || []).filter(function (h) { return h.thumb && h.full; });
        if (!hits.length) return;
        weeklyFeature = { theme: theme, hit: hits[wnum % hits.length] };
        try { localStorage.setItem(WEEKLY_KEY, JSON.stringify({ week: wk, theme: theme, hit: weeklyFeature.hit })); } catch (_) {}
        buildMenu();
      }).catch(function () {});
  }

  function refreshGGBar() {
    if (!el.ggStreak) return;
    el.ggStreak.textContent = '🔥 ' + gg.streak;
    el.ggLevel.textContent = '⭐ ' + levelOf(gg.xp).name;
  }

  function renderWeeklyCard() {
    const wk = String(weekStartIdx());
    const days = (gg.week.key === wk) ? gg.week.days : [false, false, false, false, false, false, false];
    const count = days.filter(Boolean).length;
    const perfect = count === 7;
    const labels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
    let dots = '';
    for (let i = 0; i < 7; i++) dots += '<span class="wk-dot' + (days[i] ? ' on' : '') + '">' + labels[i] + '</span>';
    const card = document.createElement('div');
    card.className = 'weekly-card' + (perfect ? ' perfect' : '');
    card.innerHTML =
      '<div class="wk-head"><span class="wk-title">📅 Meta da semana</span>' +
      '<span class="wk-count">' + (perfect ? 'Perfeita! 🏆' : count + '/7') + '</span></div>' +
      '<div class="wk-dots">' + dots + '</div>';
    el.menuGrid.appendChild(card);
  }

  function renderWeeklyReward() {
    if (gg.weeklyUnlocked !== String(weekStartIdx()) || !weeklyFeature) return;
    const f = weeklyFeature;
    const card = document.createElement('button');
    card.className = 'feature-card weekly-reward';
    const im = document.createElement('img'); im.className = 'feature-thumb'; im.src = f.hit.thumb; im.alt = '';
    card.appendChild(im);
    const body = document.createElement('span'); body.className = 'feature-body';
    body.innerHTML = '<span class="feature-kicker">🏆 Quadro da Semana</span><span class="feature-title">' + cap(f.theme) + '</span>';
    card.appendChild(body);
    const go = document.createElement('span'); go.className = 'feature-go'; go.textContent = 'Jogar ›'; card.appendChild(go);
    card.addEventListener('click', function () {
      ws.fromDaily = false;
      openWebSearch(); el.wsQ.value = f.theme;
      el.wsStatus.textContent = 'Quadro da Semana: ' + cap(f.theme);
      renderWsResults([f.hit]); wsPick(f.hit);
    });
    el.menuGrid.appendChild(card);
  }

  // Rewards / profile overlay
  function openRewards() { renderRewards(); el.rewards.classList.remove('hidden'); }
  function closeRewards() { el.rewards.classList.add('hidden'); }
  function renderRewards() {
    const lv = levelOf(gg.xp);
    el.rwLevel.textContent = lv.name;
    el.rwXp.textContent = lv.next ? (gg.xp + ' / ' + lv.next + ' XP') : (gg.xp + ' XP');
    el.rwBar.style.width = (lv.next ? Math.round((gg.xp - lv.min) / (lv.next - lv.min) * 100) : 100) + '%';
    el.rwStreak.textContent = gg.streak + (gg.streak === 1 ? ' dia' : ' dias') + ' · recorde ' + gg.bestStreak;
    const wk = String(weekStartIdx());
    const days = (gg.week.key === wk) ? gg.week.days : [false, false, false, false, false, false, false];
    const labels = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
    let dots = '';
    for (let i = 0; i < 7; i++) dots += '<span class="wk-dot' + (days[i] ? ' on' : '') + '">' + labels[i] + '</span>';
    el.rwWeek.innerHTML = dots;
    el.rwAch.innerHTML = '';
    ACHIEVEMENTS.forEach(function (a) {
      const got = !!gg.ach[a.id];
      const d = document.createElement('div');
      d.className = 'ach' + (got ? ' got' : '');
      d.innerHTML = '<span class="ach-ic">' + a.icon + '</span>' +
        '<span class="ach-t">' + a.title + '</span><span class="ach-d">' + a.desc + '</span>';
      el.rwAch.appendChild(d);
    });
    updateAccountUI();
  }

  // =========================================================================
  //  Cloud sync (Fase 1): login por código de e-mail (Supabase) + merge
  // =========================================================================
  // Config: preenchido depois que o usuário criar o projeto Supabase. Pode ser
  // sobrescrito via localStorage (para testes) com as chaves supaUrl/supaKey.
  const SUPABASE_URL = 'https://COLE-AQUI.supabase.co';
  const SUPABASE_ANON = 'COLE-AQUI-ANON-KEY';
  let sb = null;          // supabase client
  let cloudUser = null;   // { id, email } quando logado
  let pushTimer = 0;

  function cloudCfg() {
    let url = SUPABASE_URL, key = SUPABASE_ANON;
    try { url = localStorage.getItem(STORAGE_PREFIX + 'supaUrl') || url; key = localStorage.getItem(STORAGE_PREFIX + 'supaKey') || key; } catch (_) {}
    return { url: url, key: key };
  }
  function cloudConfigured() { const c = cloudCfg(); return c.url.indexOf('COLE-AQUI') < 0 && c.key.indexOf('COLE-AQUI') < 0; }

  function loadSupabaseSDK() {
    return new Promise(function (res, rej) {
      if (window.supabase && window.supabase.createClient) return res();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function cloudInit() {
    if (!cloudConfigured()) { updateAccountUI(); return; }
    loadSupabaseSDK().then(function () {
      const c = cloudCfg();
      try { sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }); }
      catch (_) { sb = null; updateAccountUI(); return; }
      // Handles both the restored session on load (INITIAL_SESSION) and a fresh
      // sign-in when the user returns from the e-mail link (SIGNED_IN).
      sb.auth.onAuthStateChange(function (_event, session) {
        const was = !!cloudUser;
        cloudUser = (session && session.user) ? { id: session.user.id, email: session.user.email } : null;
        if (cloudUser && !was) onSignedIn().then(function () { updateAccountUI(); accountStatus('Conectado e sincronizado ✓'); });
        else updateAccountUI();
      });
      updateAccountUI();
    }, function () { updateAccountUI(); });
  }

  // ---- snapshots + merge --------------------------------------------------
  const CLOUD_RESERVED = { custom:1, menu:1, last:1, daily:1, weekly:1, gg:1, tut:1, dailyUsed:1, proxy:1, supaUrl:1, supaKey:1 };
  function progressSnapshot() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(STORAGE_PREFIX) !== 0) continue;
        const suf = k.slice(STORAGE_PREFIX.length);
        if (CLOUD_RESERVED[suf]) continue;
        try { const v = JSON.parse(localStorage.getItem(k)); if (Array.isArray(v)) out[suf] = v; } catch (_) {}
      }
    } catch (_) {}
    return out;
  }
  function localSnapshot() { return { gg: gg, progress: progressSnapshot() }; }
  function applySnapshot(snap) {
    if (snap.gg) { gg = normalizeGG(snap.gg); try { localStorage.setItem(GG_KEY, JSON.stringify(gg)); } catch (_) {} }
    if (snap.progress) for (const id in snap.progress) {
      try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(snap.progress[id])); } catch (_) {}
    }
  }

  // Order-independent merge: max for cumulative counters, union for sets. Keeps
  // logging in from resetting your streak/medals.
  function mergeGGpair(a, b) {
    a = normalizeGG(a); b = normalizeGG(b);
    const g = normalizeGG({});
    g.xp = Math.max(a.xp, b.xp);
    g.regionsPainted = Math.max(a.regionsPainted, b.regionsPainted);
    g.boardsCompleted = Math.max(a.boardsCompleted, b.boardsCompleted);
    g.bestStreak = Math.max(a.bestStreak, b.bestStreak);
    const ad = (a.lastActiveDay == null ? -1 : a.lastActiveDay), bd = (b.lastActiveDay == null ? -1 : b.lastActiveDay);
    if (ad === bd) { g.lastActiveDay = (ad < 0 ? null : ad); g.streak = Math.max(a.streak, b.streak); }
    else if (ad > bd) { g.lastActiveDay = a.lastActiveDay; g.streak = a.streak; }
    else { g.lastActiveDay = b.lastActiveDay; g.streak = b.streak; }
    g.bestStreak = Math.max(g.bestStreak, g.streak);
    g.freezes = Math.max(a.freezes, b.freezes);
    if (a.week.key === b.week.key) { g.week = { key: a.week.key, days: a.week.days.map(function (d, i) { return d || b.week.days[i]; }) }; }
    else { g.week = (Number(a.week.key) >= Number(b.week.key)) ? a.week : b.week; }
    const au = a.weeklyUnlocked ? Number(a.weeklyUnlocked) : -1, bu = b.weeklyUnlocked ? Number(b.weeklyUnlocked) : -1;
    g.weeklyUnlocked = au >= bu ? (a.weeklyUnlocked || null) : (b.weeklyUnlocked || null);
    g.ach = Object.assign({}, b.ach);
    for (const k in a.ach) if (!g.ach[k] || a.ach[k] < g.ach[k]) g.ach[k] = a.ach[k];
    return g;
  }
  function mergeProgressPair(a, b) {
    const out = {}, ids = {};
    for (const k in (a || {})) ids[k] = 1;
    for (const k in (b || {})) ids[k] = 1;
    for (const id in ids) {
      const seen = {};
      ((a && a[id]) || []).forEach(function (x) { seen[x] = 1; });
      ((b && b[id]) || []).forEach(function (x) { seen[x] = 1; });
      out[id] = Object.keys(seen).map(Number).sort(function (x, y) { return x - y; });
    }
    return out;
  }
  function mergeSnapshots(a, b) {
    a = a || {}; b = b || {};
    return { gg: mergeGGpair(a.gg || {}, b.gg || {}), progress: mergeProgressPair(a.progress || {}, b.progress || {}) };
  }

  // ---- auth actions + sync ------------------------------------------------
  function onSignedIn() {
    if (!sb || !cloudUser) return Promise.resolve();
    return sb.from('profiles').select('data').eq('id', cloudUser.id).single().then(function (res) {
      const cloud = (res && res.data && res.data.data) ? res.data.data : {};
      const merged = mergeSnapshots(localSnapshot(), cloud);
      applySnapshot(merged);
      return cloudPush(merged);
    }, function () { return cloudPush(localSnapshot()); }).then(function () {
      refreshGGBar();
      if (el.rewards && !el.rewards.classList.contains('hidden')) renderRewards();
      if (el.menu && !el.menu.classList.contains('hidden')) buildMenu();
    });
  }
  function cloudPush(snap) {
    if (!sb || !cloudUser) return Promise.resolve();
    return sb.from('profiles').upsert({ id: cloudUser.id, data: snap || localSnapshot(), updated_at: new Date().toISOString() })
      .then(function () {}, function () {});
  }
  function cloudPushSoon() {
    if (!sb || !cloudUser) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { cloudPush(localSnapshot()); }, 2500);
  }

  const acct = { email: '' };
  function accountStatus(msg) { const s = document.getElementById('rw-auth-status'); if (s) s.textContent = msg || ''; }

  function cloudSendLink() {
    const email = (acct.email || '').trim();
    if (!sb || !email || email.indexOf('@') < 0) { accountStatus('Digite um e-mail válido.'); return; }
    accountStatus('Enviando link…');
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
      if (r && r.error) { accountStatus('Erro: ' + r.error.message); return; }
      accountStatus('Enviamos um link de acesso para ' + email + '. Abra o e-mail e toque em "Entrar" — você volta pro jogo já logado.');
    }, function () { accountStatus('Falha ao enviar o link.'); });
  }
  function cloudSignOut() {
    if (!sb) return;
    sb.auth.signOut().then(function () { cloudUser = null; updateAccountUI(); });
  }

  function updateAccountUI() {
    if (!el.rwAccountSec) return;
    if (!cloudConfigured()) { el.rwAccountSec.style.display = 'none'; return; }
    el.rwAccountSec.style.display = '';
    const box = el.rwAccount;
    if (cloudUser) {
      box.innerHTML = '<p class="rw-acct-line">Conectado como <b>' + (cloudUser.email || 'você') + '</b></p>' +
        '<p class="rw-acct-sub">Seu progresso sincroniza automaticamente. ✓</p>' +
        '<button id="rw-signout" class="btn-ghost">Sair</button>';
      const so = document.getElementById('rw-signout'); if (so) so.addEventListener('click', cloudSignOut);
      return;
    }
    box.innerHTML =
      '<p class="rw-acct-sub">Entre para <b>salvar e sincronizar</b> sua ofensiva, medalhas e progresso em outros aparelhos.</p>' +
      '<input id="rw-email" class="name-input" type="email" inputmode="email" placeholder="seu@email.com" />' +
      '<button id="rw-auth-btn" class="btn-primary">Enviar link de acesso</button>' +
      '<p id="rw-auth-status" class="rw-acct-sub"></p>';
    const em = document.getElementById('rw-email'); if (em) { em.value = acct.email; em.addEventListener('input', function () { acct.email = em.value; }); }
    const btn = document.getElementById('rw-auth-btn'); if (btn) btn.addEventListener('click', cloudSendLink);
  }

  function buildMenu() {
    el.menuGrid.innerHTML = '';
    const q = menuQuery.trim().toLowerCase();
    if (!q) { renderWeeklyReward(); renderContinueCard(); renderDailyCard(); renderWeeklyCard(); }
    refreshGGBar();
    renderActionTiles();
    syncMenuTools();

    let items = allBoards();
    if (menuState.onlyTodo) items = items.filter(function (it) { return pctOf(it.board) < 100; });
    if (q) items = items.filter(function (it) { return it.board.title.toLowerCase().indexOf(q) >= 0; });

    if (q || menuState.sort === 'name') {
      items.sort(function (a, b) { return a.board.title.localeCompare(b.board.title, 'pt'); });
      items.forEach(renderItemCard);
    } else if (menuState.sort === 'date') {
      // custom boards newest-first (by import date), then the rest A–Z
      items.sort(function (a, b) {
        if (a.custom && b.custom) return b.date - a.date;
        if (a.custom) return -1;
        if (b.custom) return 1;
        return a.board.title.localeCompare(b.board.title, 'pt');
      });
      items.forEach(renderItemCard);
    } else { // 'cat' — grouped into collapsible sections
      const byCat = {};
      items.forEach(function (it) { (byCat[it.cat] || (byCat[it.cat] = [])).push(it); });
      CATEGORY_ORDER.forEach(function (cat) {
        const list = byCat[cat]; if (!list || !list.length) return;
        addCollapsibleSection(cat, list.length);
        if (!menuState.collapsed.has(cat)) list.forEach(renderItemCard);
      });
    }

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'menu-empty';
      empty.textContent = q ? ('Nada encontrado para “' + menuQuery.trim() + '”.')
        : (menuState.onlyTodo ? 'Nada por fazer — tudo concluído! 🎉' : 'Nenhum quadro ainda.');
      el.menuGrid.appendChild(empty);
    }
  }

  function renderItemCard(it) {
    const card = makeCard(it.board, pctOf(it.board), it.custom);
    card.addEventListener('click', it.start);
    el.menuGrid.appendChild(card);
  }

  // The create/import action tiles, always shown at the top.
  function renderActionTiles() {
    const tiles = [
      { cls: 'card-add', icon: '+', label: 'Enviar imagem', on: openUpload },
      { cls: 'card-add card-add-svg', icon: '◆', label: 'Enviar SVG (vetor)', on: openSvgImport },
      { cls: 'card-add card-add-web', icon: '🔎', label: 'Buscar na web', on: openWebSearch },
      { cls: 'card-add card-add-open', icon: '📂', label: 'Abrir quadro recebido', on: function () { el.boardFile.value = ''; el.boardFile.click(); } }
    ];
    tiles.forEach(function (t) {
      const b = document.createElement('button');
      b.className = 'card ' + t.cls;
      b.setAttribute('aria-label', t.label);
      b.innerHTML = '<span class="add-plus">' + t.icon + '</span><span class="add-label">' + t.label + '</span>';
      b.addEventListener('click', t.on);
      el.menuGrid.appendChild(b);
    });
  }

  // A category header that toggles its section open/closed (persisted).
  function addCollapsibleSection(title, count) {
    const collapsed = menuState.collapsed.has(title);
    const h = document.createElement('button');
    h.className = 'menu-section' + (collapsed ? ' collapsed' : '');
    h.innerHTML = '<span class="sec-chev">▾</span><span class="sec-name">' + title + '</span>' +
                  '<span class="sec-count">' + count + '</span>';
    h.addEventListener('click', function () {
      if (menuState.collapsed.has(title)) menuState.collapsed.delete(title);
      else menuState.collapsed.add(title);
      saveMenuState();
      buildMenu();
    });
    el.menuGrid.appendChild(h);
  }

  // Reflect current sort/filter in the toolbar controls.
  function syncMenuTools() {
    if (el.menuSort) {
      Array.prototype.forEach.call(el.menuSort.children, function (b) {
        b.classList.toggle('on', b.dataset.sort === menuState.sort);
      });
    }
    if (el.menuTodo) el.menuTodo.checked = menuState.onlyTodo;
  }

  function makeCard(board, pct, deletable) {
    const card = document.createElement('button');
    card.className = 'card';
    card.setAttribute('aria-label', board.title);
    card.appendChild(buildThumbnail(board, pct));
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.innerHTML =
      '<span class="card-title">' + board.title + '</span>' +
      '<span class="card-sub">' + board.subtitle + '</span>' +
      '<span class="card-progress">' + (pct === 100 ? '✓ Concluído' : pct + '%') + '</span>';
    card.appendChild(meta);
    if (deletable) {
      const shr = document.createElement('span');
      shr.className = 'card-share';
      shr.textContent = '📤';
      shr.setAttribute('role', 'button');
      shr.setAttribute('aria-label', 'Enviar para um amigo');
      shr.addEventListener('click', function (e) {
        e.stopPropagation();
        openBoardShare(board);
      });
      card.appendChild(shr);

      const ren = document.createElement('span');
      ren.className = 'card-rename';
      ren.textContent = '✎';
      ren.setAttribute('role', 'button');
      ren.setAttribute('aria-label', 'Renomear');
      ren.addEventListener('click', function (e) {
        e.stopPropagation();
        const nn = prompt('Novo nome para o quadro:', board.title);
        if (nn != null) { const t = nn.trim(); if (t) { renameCustomBoard(board.id, t); buildMenu(); } }
      });
      card.appendChild(ren);

      const del = document.createElement('span');
      del.className = 'card-del';
      del.textContent = '✕';
      del.setAttribute('role', 'button');
      del.setAttribute('aria-label', 'Excluir');
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        if (confirm('Excluir "' + board.title + '"?')) { deleteCustomBoard(board.id); buildMenu(); }
      });
      card.appendChild(del);
    }
    return card;
  }

  // A small colored preview: regions already completed show their true color,
  // the rest stay gray, so the card doubles as a progress preview.
  function buildThumbnail(board, pct) {
    const saved = loadProgress(board.id) || [];
    const done = new Set(saved);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', board.viewBox);
    svg.setAttribute('class', 'thumb');
    let revealId = null;
    if (board.revealImage) { const defs = svgEl('defs', {}); const rp = revealPattern(board); defs.appendChild(rp.pat); svg.appendChild(defs); revealId = rp.id; }
    board.regions.forEach(function (r, i) {
      const s = makeShape(r);
      s.setAttribute('fill', done.has(i) ? (revealId ? 'url(#' + revealId + ')' : board.palette[r.color]) : UNFILLED);
      s.setAttribute('stroke', '#d7d7d7');
      s.setAttribute('stroke-width', '0.3');
      svg.appendChild(s);
    });
    return svg;
  }

  // =========================================================================
  //  SVG shape construction
  // =========================================================================
  function makeShape(region) {
    const s = document.createElementNS(SVG_NS, region.shape);
    const g = region.geo;
    for (const k in g) s.setAttribute(k, g[k]);
    return s;
  }

  // =========================================================================
  //  Level lifecycle
  // =========================================================================
  function startLevel(lvl) { startBoard(getBoard(lvl)); }

  // Start an already-baked board (built-in or generated from a photo).
  function startBoard(board) {
    state.level = board;
    try { localStorage.setItem(LAST_KEY, board.id); } catch (_) {}   // for "Continuar"
    state.regionEls = [];
    state.labelEls = [];
    state.filled = new Array(board.regions.length).fill(false);
    state.selected = 0;

    el.levelTitle.textContent = board.title;
    renderStage(board);
    restoreFilled(board);
    buildPalette(board);
    resetView();
    updateProgress();

    el.menu.classList.add('hidden');
    el.win.classList.add('hidden');
    el.game.classList.remove('hidden');
  }

  // Small NS-aware element builder.
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Reveal-on-paint: a <pattern> holding the board's ORIGINAL colors (gradients,
  // shading) aligned to the viewBox. A painted region filled with url(#id) shows
  // the true art within its shape instead of a flat color — so gradients survive.
  // Unique id per SVG so multiple boards on screen don't cross-reference.
  let revealSeq = 0;
  function revealPattern(board) {
    const vb = board.viewBox.split(/\s+/).map(Number);
    const id = 'reveal-' + (++revealSeq);
    const pat = svgEl('pattern', { id: id, patternUnits: 'userSpaceOnUse', width: vb[2], height: vb[3] });
    const im = svgEl('image', { x: 0, y: 0, width: vb[2], height: vb[3], preserveAspectRatio: 'none' });
    im.setAttribute('href', board.revealImage);
    im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', board.revealImage);
    pat.appendChild(im);
    return { pat: pat, id: id };
  }

  // The permanent line-art layer. Curated boards carry the ORIGINAL art's lines
  // as a high-res raster (inkImage) — full fidelity, every detail kept. Uploads
  // fall back to the vectorized ink (filled shapes, or an older stroke path).
  function buildInkLayer(board) {
    const vb = board.viewBox.split(/\s+/).map(Number);
    if (board.inkImage) {
      const im = svgEl('image', { x: 0, y: 0, width: vb[2], height: vb[3], preserveAspectRatio: 'none' });
      im.setAttribute('href', board.inkImage);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', board.inkImage);
      return im;
    }
    if (board.inkPath) {
      // Soft charcoal (not pure black) for a lighter, more minimalist contour
      // that a dark fill doesn't disappear into.
      return board.inkFilled
        ? svgEl('path', { d: board.inkPath, fill: '#2b2b2b', 'fill-rule': 'evenodd' })
        : svgEl('path', { d: board.inkPath, fill: 'none', stroke: '#2b2b2b',
            'stroke-width': board.inkWidth || 0.7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    }
    return null;
  }

  function renderStage(lvl) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', lvl.viewBox);
    svg.setAttribute('id', 'art');
    // Honor the board's aspect ratio (photos aren't square).
    const vb = lvl.viewBox.split(/\s+/).map(Number);
    if (vb[2] && vb[3]) svg.style.aspectRatio = vb[2] + ' / ' + vb[3];
    state.svg = svg;

    // Diagonal hatch used to mark the regions of the currently selected color.
    // It's opaque (has its own background), so it can never reveal a filled
    // region sitting behind it. A single fixed blue tone, like classic
    // color-by-number games — it flags "fill these" without hinting the color.
    const defs = svgEl('defs', {});
    const pat = svgEl('pattern', {
      id: 'hatch', patternUnits: 'userSpaceOnUse',
      width: HATCH_TILE, height: HATCH_TILE, patternTransform: 'rotate(45)'
    });
    const hrect = svgEl('rect', { width: HATCH_TILE, height: HATCH_TILE, fill: HATCH_BG });
    pat.appendChild(hrect);
    const line = svgEl('line', {
      x1: 0, y1: 0, x2: 0, y2: HATCH_TILE, 'stroke-width': HATCH_STRIPE, class: 'hatch-line'
    });
    line.setAttribute('stroke', HATCH_STROKE);
    pat.appendChild(line);
    defs.appendChild(pat);
    // keep refs so the hatch can be re-scaled with the zoom (finer when zoomed
    // in) — otherwise a region smaller than the tile never shows a stripe.
    state.hatch = { pat: pat, rect: hrect, line: line };
    // Reveal-on-paint pattern (boards that carry the original art, e.g. from SVG
    // with gradients). Painting a region uncovers the real gradient/shading.
    state.revealId = null;
    if (lvl.revealImage) { const rp = revealPattern(lvl); defs.appendChild(rp.pat); state.revealId = rp.id; }
    svg.appendChild(defs);

    // Seamless backing: the flat solution as a raster, UNDER the tiles. Opaque
    // unfilled tiles hide it until painted; then it fills the sub-pixel seams
    // between abutting vector tiles with the correct color instead of white.
    if (lvl.solutionImage) {
      const bg = svgEl('image', { x: 0, y: 0, width: vb[2], height: vb[3], preserveAspectRatio: 'none' });
      bg.setAttribute('href', lvl.solutionImage);
      bg.setAttributeNS('http://www.w3.org/1999/xlink', 'href', lvl.solutionImage);
      bg.style.pointerEvents = 'none';
      svg.appendChild(bg);
    }

    lvl.regions.forEach(function (r, i) {
      const shape = makeShape(r);
      shape.setAttribute('class', 'region');
      shape.setAttribute('fill', UNFILLED);
      shape.setAttribute('stroke', '#c9c9c9');
      shape.setAttribute('stroke-width', '0.5');
      shape.dataset.index = i;
      shape.dataset.color = r.color;
      shape.addEventListener('click', onRegionClick);
      svg.appendChild(shape);
      state.regionEls[i] = shape;
    });

    // Permanent black line-art on top of the colors (ignores taps).
    const ink = buildInkLayer(lvl);
    if (ink) { ink.style.pointerEvents = 'none'; svg.appendChild(ink); }

    el.stage.innerHTML = '';
    el.stage.appendChild(svg);

    // Number labels are added after all shapes (so they sit on top) AND after
    // the SVG is attached to the DOM — getBBox() only reports real geometry for
    // rendered elements, which the auto-centering fallback relies on.
    lvl.regions.forEach(function (r, i) {
      const label = document.createElementNS(SVG_NS, 'text');
      const c = labelCenter(state.regionEls[i], r);
      label.setAttribute('x', c.x);
      label.setAttribute('y', c.y);
      label.setAttribute('class', 'region-num');
      // Base size fitted to the region; CSS counter-scales it by zoom so it
      // reads small and constant on screen (and only once zoomed in).
      const radius = r.area ? Math.sqrt(r.area * (100 / 300) * (100 / 300) / Math.PI) : 4;
      label.style.setProperty('--fs', Math.max(2.0, Math.min(3.4, radius * 0.7)).toFixed(2));
      label.textContent = String(r.color + 1);
      svg.appendChild(label);
      state.labelEls[i] = label;
    });
  }

  // Where to draw a region's number. An explicit lx/ly always wins; otherwise
  // the center is derived from the shape geometry so it never depends on layout
  // timing (getBBox on a freshly-rendered SVG can momentarily report zeros).
  function labelCenter(shapeEl, region) {
    if (typeof region.lx === 'number' && typeof region.ly === 'number') {
      return { x: region.lx, y: region.ly };
    }
    const g = region.geo;
    switch (region.shape) {
      case 'rect':
        return { x: +g.x + +g.width / 2, y: +g.y + +g.height / 2 };
      case 'circle':
      case 'ellipse':
        return { x: +g.cx, y: +g.cy };
      case 'polygon': {
        const pts = g.points.trim().split(/\s+/).map(function (p) {
          const xy = p.split(','); return { x: +xy[0], y: +xy[1] };
        });
        const sum = pts.reduce(function (a, p) { return { x: a.x + p.x, y: a.y + p.y }; }, { x: 0, y: 0 });
        return { x: sum.x / pts.length, y: sum.y / pts.length };
      }
      default:
        // path or unknown: fall back to bbox (rendered by now)
        try {
          const b = shapeEl.getBBox();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        } catch (_) {
          return { x: 50, y: 50 };
        }
    }
  }

  function restoreFilled(lvl) {
    const saved = loadProgress(lvl.id);
    if (!saved) return;
    saved.forEach(function (i) {
      if (i >= 0 && i < lvl.regions.length) fillRegion(i, false);
    });
  }

  // =========================================================================
  //  Palette
  // =========================================================================
  function buildPalette(lvl) {
    el.palette.innerHTML = '';
    lvl.palette.forEach(function (hex, ci) {
      const swatch = document.createElement('button');
      swatch.className = 'swatch';
      swatch.dataset.color = ci;
      swatch.style.setProperty('--c', hex);
      swatch.innerHTML =
        '<span class="swatch-num">' + (ci + 1) + '</span>' +
        '<span class="swatch-count"></span>';
      swatch.addEventListener('click', function () { selectColor(ci); });
      el.palette.appendChild(swatch);
    });
    selectColor(firstIncompleteColor());
    refreshPaletteCounts();
  }

  function remainingForColor(ci) {
    let n = 0;
    state.level.regions.forEach(function (r, i) {
      if (r.color === ci && !state.filled[i]) n++;
    });
    return n;
  }

  function firstIncompleteColor() {
    for (let ci = 0; ci < state.level.palette.length; ci++) {
      if (remainingForColor(ci) > 0) return ci;
    }
    return 0;
  }

  function selectColor(ci) {
    state.selected = ci;
    Array.prototype.forEach.call(el.palette.children, function (sw) {
      const on = Number(sw.dataset.color) === ci;
      sw.classList.toggle('active', on);
      if (on && sw.scrollIntoView) {
        sw.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      }
    });
    highlightSelected();
  }

  function refreshPaletteCounts() {
    Array.prototype.forEach.call(el.palette.children, function (sw) {
      const ci = Number(sw.dataset.color);
      const left = remainingForColor(ci);
      const countEl = sw.querySelector('.swatch-count');
      countEl.textContent = left > 0 ? String(left) : '';
      sw.classList.toggle('done', left === 0);
    });
  }

  // Mark the regions of the selected color with the hatch pattern. Everything
  // stays fully opaque — no dimming — so a filled region behind another region
  // can never bleed through into an unpainted space.
  function highlightSelected() {
    state.regionEls.forEach(function (shape, i) {
      if (state.filled[i]) { shape.classList.remove('target'); return; }
      const isTarget = state.level.regions[i].color === state.selected;
      shape.classList.toggle('target', isTarget);
      shape.setAttribute('fill', isTarget ? 'url(#hatch)' : UNFILLED);
    });
  }

  // =========================================================================
  //  Filling
  // =========================================================================
  let lastTapIndex = -1, lastTapTime = 0;

  function onRegionClick(e) {
    if (view.suppressClick) return;          // this was the tail of a pan gesture
    const i = Number(e.currentTarget.dataset.index);
    if (state.filled[i]) return;
    const region = state.level.regions[i];

    if (region.color === state.selected) {   // right color -> fill on a single tap
      fillRegion(i, true);
      afterFill(region.color);
      lastTapIndex = -1;
      return;
    }

    // Different color: a single tap does nothing (avoids switching by mistake).
    // A double tap on the same region switches to its color and fills it.
    const now = Date.now();
    if (lastTapIndex === i && now - lastTapTime < 400) {
      selectColor(region.color);
      fillRegion(i, true);
      afterFill(region.color);
      lastTapIndex = -1;
    } else {
      lastTapIndex = i;
      lastTapTime = now;
      wrongPulse(e.currentTarget);           // hint: tap again to switch
    }
  }

  function fillRegion(i, animate) {
    const region = state.level.regions[i];
    const shape = state.regionEls[i];
    const hex = state.level.palette[region.color];
    state.filled[i] = true;
    if (state.revealId) {
      // reveal the original art (gradients/shading) within this region
      shape.setAttribute('fill', 'url(#' + state.revealId + ')');
      shape.setAttribute('stroke', 'none');
    } else {
      shape.setAttribute('fill', hex);
      // Regions now tile exactly (shared-edge vectorizer), so this stroke only
      // needs to hide the sub-pixel anti-alias seam — kept tiny so it never bleeds
      // past the contour on small details.
      shape.setAttribute('stroke', hex);
      shape.setAttribute('stroke-width', '0.3');
    }
    shape.classList.remove('target');
    shape.classList.add('filled');
    if (animate) {
      shape.classList.remove('pop'); void shape.offsetWidth;   // restart if re-fired
      shape.classList.add('pop');
      setTimeout(function () { shape.classList.remove('pop'); }, 400);
    }
    if (state.labelEls[i]) state.labelEls[i].style.display = 'none';
  }

  function afterFill(justUsedColor) {
    gamifyPaint();
    refreshPaletteCounts();
    updateProgress();
    saveProgress();
    if (isComplete()) { win(); return; }
    if (remainingForColor(justUsedColor) === 0) {
      celebrateSwatch(justUsedColor);        // little flourish on the finished color
      selectColor(firstIncompleteColor());   // auto-advance to next color
    } else {
      bumpSwatchCount(justUsedColor);
      highlightSelected();
    }
  }

  function swatchEl(ci) { return el.palette.children[ci]; }

  function celebrateSwatch(ci) {
    const sw = swatchEl(ci); if (!sw) return;
    sw.classList.remove('just-done'); void sw.offsetWidth;   // restart the animation
    sw.classList.add('just-done');
    setTimeout(function () { sw.classList.remove('just-done'); }, 640);
  }

  function bumpSwatchCount(ci) {
    const sw = swatchEl(ci); if (!sw) return;
    const c = sw.querySelector('.swatch-count'); if (!c) return;
    c.classList.remove('bump'); void c.offsetWidth;
    c.classList.add('bump');
    setTimeout(function () { c.classList.remove('bump'); }, 300);
  }

  function wrongPulse(shapeEl) {
    shapeEl.classList.add('wrong');
    setTimeout(function () { shapeEl.classList.remove('wrong'); }, 300);
  }

  function isComplete() { return state.filled.every(Boolean); }

  function updateProgress() {
    const total = state.filled.length;
    const done = state.filled.filter(Boolean).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.progressBar.style.width = pct + '%';
    el.progressPct.textContent = pct + '%';
  }

  // =========================================================================
  //  Win
  // =========================================================================
  function win() {
    gamifyComplete(state.level);
    // Reveal the finished picture cleanly: hide the game UI (palette, buttons)
    // so the artwork fills the screen, then a small congrats sheet at the bottom.
    resetView();
    setTimeout(function () {
      el.game.classList.add('complete');
      el.win.classList.remove('hidden');
      launchConfetti();
      // TODO(ads): a real build shows an interstitial here between levels.
      //   AdMob.showInterstitial();
    }, 400);
  }

  // Recomeçar: wipe this board's progress and re-render it blank.
  function restartBoard() {
    if (!state.level) return;
    if (!confirm('Recomeçar este quadro? A pintura atual será apagada.')) return;
    try { localStorage.removeItem(saveKey(state.level.id)); } catch (_) { /* ignore */ }
    el.game.classList.remove('complete');
    el.win.classList.add('hidden');
    startBoard(state.level);
  }

  // ---- Share: compose a pretty card of the finished artwork ----------------
  const share = { board: null, blob: null };

  // Rasterize a board (painted or line-art) to an <img> at W×H via an SVG.
  function boardToImage(board, painted, W, H) {
    const svg = boardSvgEl(board, painted);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    return new Promise(function (res, rej) {
      const img = new Image();
      img.onload = function () { res(img); };
      img.onerror = rej;
      img.src = url;
    });
  }

  function drawArtTile(ctx, img, x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(60,45,30,0.18)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.drawImage(img, x, y, w, h);
    ctx.strokeStyle = 'rgba(60,45,30,0.10)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
  }

  // Compose the share card (paper + artwork(s) + brand footer) -> canvas.
  function buildShareCard(board, beforeAfter) {
    const vb = board.viewBox.split(/\s+/).map(Number);
    const ar = vb[2] / vb[3];
    const pad = 56, gap = 30, footer = 108;
    const artW = 860, artH = Math.max(1, Math.round(artW / ar));
    const jobs = beforeAfter
      ? [boardToImage(board, false, artW, artH), boardToImage(board, true, artW, artH)]
      : [boardToImage(board, true, artW, artH)];
    return Promise.all(jobs).then(function (imgs) {
      const cols = imgs.length;
      const cardW = pad * 2 + artW * cols + gap * (cols - 1);
      const cardH = pad * 2 + artH + footer;
      const cv = document.createElement('canvas'); cv.width = cardW; cv.height = cardH;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#faf5ea'; ctx.fillRect(0, 0, cardW, cardH);
      imgs.forEach(function (img, i) { drawArtTile(ctx, img, pad + i * (artW + gap), pad, artW, artH); });
      // brand footer
      const fy = cardH - footer / 2;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5a4a3a';
      ctx.font = '600 40px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('🏡 Cottage Color', pad, fy);
      ctx.fillStyle = '#9a8b76';
      ctx.font = '30px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(board.title || '', cardW - pad, fy);
      return cv;
    });
  }

  function refreshShareCard() {
    const board = share.board; if (!board) return;
    el.sharePreview.innerHTML = '<div id="share-spin">Gerando…</div>';
    const beforeAfter = el.shareBa.checked;
    buildShareCard(board, beforeAfter).then(function (cv) {
      cv.toBlob(function (blob) {
        share.blob = blob;
        const img = document.createElement('img');
        img.alt = 'Minha pintura';
        img.src = URL.createObjectURL(blob);
        el.sharePreview.innerHTML = '';
        el.sharePreview.appendChild(img);
      }, 'image/png');
    }).catch(function () { el.sharePreview.innerHTML = '<div id="share-spin">Não consegui gerar a imagem.</div>'; });
  }

  function openShare() {
    if (!state.level) return;
    share.board = state.level; share.blob = null;
    el.shareBa.checked = false;
    el.share.classList.remove('hidden');
    refreshShareCard();
  }
  function closeShare() { el.share.classList.add('hidden'); }

  function doShare() {
    if (!share.blob) return;
    const file = new File([share.blob], 'cottage-color.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Cottage Color', text: 'Pintei no Cottage Color 🎨' }).catch(function () {});
    } else if (navigator.share) {
      navigator.share({ title: 'Cottage Color', text: 'Pintei no Cottage Color 🎨' }).catch(function () {});
    } else {
      doDownload();
    }
  }
  function doDownload() {
    if (!share.blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(share.blob);
    a.download = 'cottage-color.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // =========================================================================
  //  Hint (rewarded-ad placeholder)
  // =========================================================================
  function useHint() {
    // TODO(ads): gate this behind a rewarded video —
    //   AdMob.showRewarded(() => grantHint());
    grantHint();
  }

  function grantHint() {
    const remaining = [];
    state.filled.forEach(function (f, i) { if (!f) remaining.push(i); });
    if (!remaining.length) return;
    const i = remaining[Math.floor(Math.random() * remaining.length)];
    const region = state.level.regions[i];
    selectColor(region.color);
    fillRegion(i, true);
    afterFill(region.color);
  }

  // =========================================================================
  //  Find next region of the selected color (essential with many regions)
  // =========================================================================
  function seekNext() {
    // Make sure we're on a color that still has work.
    if (remainingForColor(state.selected) === 0) selectColor(firstIncompleteColor());
    // Pick the largest unfilled region of the selected color — easiest to spot.
    let best = -1, bestArea = -1;
    state.level.regions.forEach(function (r, i) {
      if (!state.filled[i] && r.color === state.selected && (r.area || 0) > bestArea) {
        bestArea = r.area || 0; best = i;
      }
    });
    if (best < 0) return;
    resetView();                    // show the whole board so the target is in view
    const shape = state.regionEls[best];
    shape.classList.remove('seek');
    void shape.getBBox();           // reflow so the animation restarts
    shape.classList.add('seek');
    setTimeout(function () { shape.classList.remove('seek'); }, 1600);
  }

  // =========================================================================
  //  Pan & pinch-zoom
  // =========================================================================
  // The view is a single affine transform on #stage (origin 0,0):
  //   screen = (tx,ty) + scale * content
  // Gestures are driven off the *centroid* and *spread* of all active pointers,
  // re-anchored whenever a finger goes down/up, so adding or lifting a finger
  // never makes the image jump.
  const view = {
    pointers: new Map(),   // id -> {x,y}
    prevCx: 0, prevCy: 0,  // last gesture centroid (viewport-local)
    prevDist: 0,           // last gesture spread
    moved: 0,
    suppressClick: false
  };

  function applyTransform() {
    clampPan();
    el.stage.style.transform =
      'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
    // Numbers: reveal only once zoomed in, and counter-scale so they stay a
    // small constant size on screen instead of ballooning with the zoom.
    if (state.svg) {
      state.svg.style.setProperty('--nz', (1 / state.scale).toFixed(3));
      state.svg.classList.toggle('show-nums', state.scale >= 1.6);
    }
    // Re-scale the hatch tile with 1/zoom so its on-screen spacing stays constant
    // — zooming into a tiny region now packs enough stripes to be clearly hatched.
    if (state.hatch) {
      const t = (HATCH_TILE / state.scale), w = (HATCH_STRIPE / state.scale);
      state.hatch.pat.setAttribute('width', t.toFixed(3));
      state.hatch.pat.setAttribute('height', t.toFixed(3));
      state.hatch.rect.setAttribute('width', t.toFixed(3));
      state.hatch.rect.setAttribute('height', t.toFixed(3));
      state.hatch.line.setAttribute('y2', t.toFixed(3));
      state.hatch.line.setAttribute('stroke-width', w.toFixed(3));
    }
  }

  function resetView() { state.scale = 1; state.tx = 0; state.ty = 0; applyTransform(); }

  function clampScale(s) { return Math.min(6, Math.max(1, s)); }

  // Keep the (viewport-sized) stage covering the viewport, so you can't drag the
  // image into empty space; at scale 1 this forces it back to centered.
  function clampPan() {
    const vw = el.viewport.clientWidth, vh = el.viewport.clientHeight;
    state.tx = Math.min(0, Math.max(vw * (1 - state.scale), state.tx));
    state.ty = Math.min(0, Math.max(vh * (1 - state.scale), state.ty));
  }

  // centroid + spread of the current pointers, in viewport-local coordinates
  function gesture() {
    const rect = el.viewport.getBoundingClientRect();
    const pts = Array.from(view.pointers.values());
    let cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p.x; cy += p.y; });
    cx = cx / pts.length - rect.left;
    cy = cy / pts.length - rect.top;
    let dist = 0;
    if (pts.length >= 2) {
      dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    return { cx: cx, cy: cy, dist: dist, n: pts.length };
  }

  function reanchor() {
    const g = gesture();
    view.prevCx = g.cx; view.prevCy = g.cy; view.prevDist = g.dist;
  }

  function onPointerDown(e) {
    try { el.viewport.setPointerCapture(e.pointerId); } catch (_) { /* not a real pointer */ }
    view.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view.moved = 0;
    view.suppressClick = false;
    reanchor();                       // start fresh from the new finger set
  }

  function onPointerMove(e) {
    if (!view.pointers.has(e.pointerId)) return;
    const prev = view.pointers.get(e.pointerId);
    view.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view.moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    if (view.moved > 10) view.suppressClick = true;

    const g = gesture();
    // 1) zoom about the previous centroid (only with 2+ fingers)
    if (g.n >= 2 && view.prevDist > 0 && g.dist > 0) {
      const newScale = clampScale(state.scale * (g.dist / view.prevDist));
      const ratio = newScale / state.scale;
      state.tx = view.prevCx - ratio * (view.prevCx - state.tx);
      state.ty = view.prevCy - ratio * (view.prevCy - state.ty);
      state.scale = newScale;
    }
    // 2) pan by how much the centroid moved
    state.tx += g.cx - view.prevCx;
    state.ty += g.cy - view.prevCy;
    applyTransform();

    view.prevCx = g.cx; view.prevCy = g.cy; view.prevDist = g.dist;
  }

  function onPointerUp(e) {
    view.pointers.delete(e.pointerId);
    if (view.pointers.size > 0) reanchor();   // remaining fingers keep control, no jump
    setTimeout(function () { view.suppressClick = false; }, 0);
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = el.viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const newScale = clampScale(state.scale * (e.deltaY < 0 ? 1.12 : 0.89));
    const ratio = newScale / state.scale;
    state.tx = cx - ratio * (cx - state.tx);
    state.ty = cy - ratio * (cy - state.ty);
    state.scale = newScale;
    applyTransform();
  }

  // =========================================================================
  //  Confetti (lightweight, no dependency)
  // =========================================================================
  function launchConfetti() {
    const colors = state.level.palette;
    el.confetti.innerHTML = '';
    for (let i = 0; i < 80; i++) {
      const p = document.createElement('span');
      p.className = 'confetti-piece';
      p.style.left = Math.random() * 100 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.6) + 's';
      p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      el.confetti.appendChild(p);
    }
    setTimeout(function () { el.confetti.innerHTML = ''; }, 3200);
  }

  // =========================================================================
  //  Upload: photo -> playable board (Etapa 2)
  // =========================================================================
  const up = { img: null, board: null, colors: 24, detail: 'mid', timer: 0 };

  // maxRegions is the count BEFORE same-color folding; the board ends up smaller.
  // Kept modest so it's a playable coloring page, not a mosaic of tiny specks.
  // Same engine as the acervo (fromLineArt): higher res for crisp regions.
  // Heavier to compute, so we regenerate on release, not while dragging.
  const DETAIL = {
    low:  { gridLong: 800,  maxRegions: 110 },
    mid:  { gridLong: 1050, maxRegions: 190 },
    high: { gridLong: 1300, maxRegions: 300 }
  };

  function openUpload() {
    up.board = null;
    el.upTitle.value = 'Minha imagem';
    el.upColors.value = up.colors;
    el.upColorsVal.textContent = up.colors;
    setDetail(up.detail);
    el.upPlay.disabled = true;
    el.upPreview.innerHTML = '';
    el.upStatus.textContent = 'Escolha uma foto para começar.';
    el.upload.classList.remove('hidden');
    if (!up.img) pickFile();
  }

  function closeUpload() { el.upload.classList.add('hidden'); }

  function pickFile() { el.upFile.value = ''; el.upFile.click(); }

  function onFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); up.img = img; regen(); };
    img.onerror = function () { URL.revokeObjectURL(url); el.upStatus.textContent = 'Não consegui abrir essa imagem.'; };
    img.src = url;
  }

  function setDetail(d) {
    up.detail = d;
    Array.prototype.forEach.call(el.upDetail.children, function (btn) {
      btn.classList.toggle('on', btn.dataset.detail === d);
    });
  }

  function regenDebounced() {
    clearTimeout(up.timer);
    up.timer = setTimeout(regen, 180);
  }

  // Draw the photo into a working canvas, then run the SAME engine as the acervo
  // (fromLineArt): flat colors, exact-tiling regions, de-fringed, robust ink.
  function regen() {
    if (!up.img) return;
    el.upStatus.textContent = 'Gerando… (pode levar alguns segundos)';
    el.upPlay.disabled = true;
    // let the status paint before the (heavy) synchronous work
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      const p = DETAIL[up.detail];
      const iw = up.img.naturalWidth || up.img.width;
      const ih = up.img.naturalHeight || up.img.height;
      let gw, gh;
      if (iw >= ih) { gw = p.gridLong; gh = Math.max(1, Math.round(p.gridLong * ih / iw)); }
      else { gh = p.gridLong; gw = Math.max(1, Math.round(p.gridLong * iw / ih)); }

      const canvas = document.createElement('canvas');
      canvas.width = gw; canvas.height = gh;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Flatten transparency onto white (the line-art engine treats white as the
      // background/paper, as in the curated art).
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, gw, gh);
      ctx.drawImage(up.img, 0, 0, gw, gh);
      const imageData = ctx.getImageData(0, 0, gw, gh);

      const t0 = performance.now();
      const board = window.Pipeline.fromLineArt(imageData, {
        colors: up.colors, maxRegions: p.maxRegions, title: 'Minha Imagem'
      });
      const ms = Math.round(performance.now() - t0);

      up.board = board;
      renderUpPreview(board);
      el.upPlay.disabled = false;
      el.upStatus.textContent = board.regions.length + ' regiões · ' +
        board.palette.length + ' cores · ' + (ms / 1000).toFixed(1) + ' s';
    }); });
  }

  // Build a preview SVG of the board. painted=true → the finished colored art
  // (reveal/gradient or flat palette); painted=false → the blank line-art (for
  // a "before/after" share card).
  function boardSvgEl(board, painted) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', board.viewBox);
    svg.setAttribute('class', 'preview-svg');
    const vb = board.viewBox.split(/\s+/).map(Number);
    if (vb[2] && vb[3]) svg.style.aspectRatio = vb[2] + ' / ' + vb[3];
    let revealId = null;
    if (painted && board.revealImage) { const defs = svgEl('defs', {}); const rp = revealPattern(board); defs.appendChild(rp.pat); svg.appendChild(defs); revealId = rp.id; }
    if (!painted) { const bg = svgEl('rect', { x: 0, y: 0, width: vb[2], height: vb[3], fill: '#fbf8f2' }); svg.appendChild(bg); }
    board.regions.forEach(function (r) {
      const s = makeShape(r);
      s.setAttribute('fill', painted ? (revealId ? 'url(#' + revealId + ')' : board.palette[r.color]) : '#f4efe6');
      svg.appendChild(s);
    });
    const im = buildInkLayer(board);
    if (im) svg.appendChild(im);
    return svg;
  }
  function boardPreviewSvg(board) { return boardSvgEl(board, true); }
  function renderUpPreview(board) {
    el.upPreview.innerHTML = '';
    el.upPreview.appendChild(boardPreviewSvg(board));
  }

  // =========================================================================
  //  SVG import: vector -> playable board (highest quality)
  // =========================================================================
  const sv = { board: null };

  function openSvgImport() {
    sv.board = null;
    el.svTitle.value = 'Meu vetor';
    el.svPlay.disabled = true;
    el.svPreview.innerHTML = '';
    el.svText.value = '';
    el.svStatus.textContent = 'Cole o código do SVG ou escolha um arquivo.';
    el.svImport.classList.remove('hidden');
  }
  function closeSvgImport() { el.svImport.classList.add('hidden'); }

  function onSvgFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = function () { el.svText.value = String(r.result || ''); svGenerate(); };
    r.onerror = function () { el.svStatus.textContent = 'Não consegui ler o arquivo.'; };
    r.readAsText(file);
  }

  function svGenerate() {
    const txt = el.svText.value.trim();
    if (txt.indexOf('<svg') < 0) { el.svStatus.textContent = 'Cole um SVG válido (deve conter “<svg …>”).'; return; }
    el.svStatus.textContent = 'Gerando…';
    el.svPlay.disabled = true;
    requestAnimationFrame(function () {
      const t0 = performance.now();
      window.Pipeline.fromSVG(txt, { title: 'Meu Vetor', id: 'svg-' + Date.now() }).then(function (board) {
        sv.board = board;
        el.svPreview.innerHTML = '';
        el.svPreview.appendChild(boardPreviewSvg(board));
        el.svPlay.disabled = false;
        el.svStatus.textContent = board.regions.length + ' regiões · ' + board.palette.length +
          ' cores · ' + Math.round(performance.now() - t0) + ' ms';
      }).catch(function (err) {
        el.svStatus.textContent = 'Erro: ' + ((err && err.message) || 'não consegui processar o SVG');
      });
    });
  }

  function svPlay() {
    if (!sv.board) return;
    sv.board.title = customTitle(el.svTitle, 'Meu vetor');
    addCustomBoard(sv.board);
    const board = sv.board; sv.board = null;
    closeSvgImport();
    buildMenu();
    startBoard(board);
  }

  // =========================================================================
  //  Web search: Pixabay illustrations -> playable board (Etapa 3)
  // =========================================================================
  // A tiny Cloudflare Worker (see /worker) hides the Pixabay key and adds CORS.
  // Filled in once the Worker is deployed; can be overridden via localStorage
  // ('cottagecolor:proxy') for testing before it's hardcoded.
  const WEB_SEARCH_PROXY = 'https://cottage-color-proxy.fernando-apparecido.workers.dev';

  const ws = { board: null, img: null, colors: 24, detail: 'mid', title: 'Imagem da web', fromDaily: false };

  function proxyBase() {
    let b = WEB_SEARCH_PROXY;
    try { b = localStorage.getItem('cottagecolor:proxy') || b; } catch (_) {}
    return b.replace(/\/+$/, '');
  }
  function proxyReady() { return proxyBase().indexOf('COLE-AQUI') < 0; }

  function openWebSearch() {
    ws.board = null;
    ws.fromDaily = false;
    el.wsResults.innerHTML = '';
    el.wsMake.classList.add('hidden');
    el.wsPlayBtn.disabled = true;
    el.wsQ.value = '';
    el.wsStatus.textContent = proxyReady()
      ? 'Digite um tema e toque em Buscar.'
      : 'A busca na web ainda está sendo configurada. Volte em breve! 🙂';
    el.webSearch.classList.remove('hidden');
    if (proxyReady()) setTimeout(function () { el.wsQ.focus(); }, 60);
  }
  function closeWebSearch() { el.webSearch.classList.add('hidden'); }

  function wsSearch() {
    ws.fromDaily = false;   // a manual search is not the daily image
    const q = el.wsQ.value.trim();
    if (!proxyReady()) { el.wsStatus.textContent = 'A busca na web ainda não foi configurada.'; return; }
    if (!q) { el.wsStatus.textContent = 'Digite um tema para buscar.'; return; }
    el.wsMake.classList.add('hidden');
    el.wsResults.innerHTML = '';
    el.wsStatus.textContent = 'Buscando…';
    fetch(proxyBase() + '/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { el.wsStatus.textContent = 'Erro na busca: ' + data.error; return; }
        const hits = (data.hits || []).filter(function (h) { return h.thumb && h.full; });
        if (!hits.length) { el.wsStatus.textContent = 'Nada encontrado para “' + q + '”. Tente outro tema.'; return; }
        el.wsStatus.textContent = 'Escolha uma imagem:';
        renderWsResults(hits);
      })
      .catch(function () {
        el.wsStatus.textContent = 'Não consegui conectar à busca. Tente de novo.';
      });
  }

  function renderWsResults(hits) {
    el.wsResults.innerHTML = '';
    hits.forEach(function (h) {
      const b = document.createElement('button');
      b.className = 'ws-thumb';
      b.setAttribute('aria-label', h.tags || 'imagem');
      const im = document.createElement('img');
      im.loading = 'lazy';
      im.src = h.thumb;
      b.appendChild(im);
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.wsResults.children, function (c) { c.classList.remove('sel'); });
        b.classList.add('sel');
        wsPick(h);
      });
      el.wsResults.appendChild(b);
    });
  }

  function wsPick(hit) {
    ws.board = null;
    ws.img = null;
    ws.title = hitTitle(hit);
    // reset the controls to defaults for each new image
    ws.colors = 24; el.wsColors.value = 24; el.wsColorsVal.textContent = 24;
    wsSetDetail('mid');
    el.wsPlayBtn.disabled = true;
    el.wsPreview.innerHTML = '';
    el.wsMake.classList.remove('hidden');
    el.wsMakeStatus.textContent = 'Baixando imagem…';
    el.wsMake.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { ws.img = img; wsRegen(); };
    img.onerror = function () {
      el.wsMakeStatus.textContent = 'Não consegui baixar essa imagem. Tente outra.';
    };
    img.src = proxyBase() + '/img?u=' + encodeURIComponent(hit.full);
  }

  function wsSetDetail(d) {
    ws.detail = d;
    Array.prototype.forEach.call(el.wsDetail.children, function (btn) {
      btn.classList.toggle('on', btn.dataset.detail === d);
    });
  }

  // Regenerate the board from the already-downloaded image with the current
  // Cores/Dificuldade settings (no re-download).
  function wsRegen() {
    if (!ws.img) return;
    el.wsPlayBtn.disabled = true;
    el.wsMakeStatus.textContent = 'Gerando quadro… (alguns segundos)';
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      try {
        const board = boardFromImage(ws.img, { colors: ws.colors, detail: ws.detail, title: ws.title });
        ws.board = board;
        el.wsPreview.innerHTML = '';
        el.wsPreview.appendChild(boardPreviewSvg(board));
        el.wsPlayBtn.disabled = false;
        el.wsMakeStatus.textContent = board.regions.length + ' regiões · ' + board.palette.length + ' cores';
      } catch (e) {
        el.wsMakeStatus.textContent = 'Não consegui processar essa imagem. Tente outra.';
      }
    }); });
  }

  function hitTitle(hit) {
    const t = String(hit.tags || '').split(',')[0].trim();
    if (!t) return 'Imagem da web';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Draw an <img> into a working canvas and run fromLineArt (same engine as the
  // acervo/upload). Shared by the web-search flow.
  function boardFromImage(img, opts) {
    const p = DETAIL[opts.detail || 'mid'];
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    let gw, gh;
    if (iw >= ih) { gw = p.gridLong; gh = Math.max(1, Math.round(p.gridLong * ih / iw)); }
    else { gh = p.gridLong; gw = Math.max(1, Math.round(p.gridLong * iw / ih)); }
    const canvas = document.createElement('canvas');
    canvas.width = gw; canvas.height = gh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, gw, gh);
    ctx.drawImage(img, 0, 0, gw, gh);
    const imageData = ctx.getImageData(0, 0, gw, gh);
    return window.Pipeline.fromLineArt(imageData, {
      colors: opts.colors || 24, maxRegions: p.maxRegions, title: opts.title || 'Imagem da web'
    });
  }

  function wsPlay() {
    if (!ws.board) return;
    ws.board.fromDaily = !!ws.fromDaily;
    if (ws.fromDaily) markDailyUsed();   // stop offering today's image again
    addCustomBoard(ws.board);
    const board = ws.board; ws.board = null;
    closeWebSearch();
    buildMenu();
    startBoard(board);
  }

  // =========================================================================
  //  Share a PLAYABLE board with a friend (Etapa 3+) — link or file
  // =========================================================================
  // A custom board is already plain JSON (that's how it's saved), so sharing is
  // just serialize -> deliver -> import. Link uses the Worker's KV (/share,
  // /board); file works with no server at all.
  let shareTarget = null;   // board currently being shared

  function openBoardShare(board) {
    shareTarget = board;
    gamifyShare();
    el.bsStatus.textContent = proxyReady()
      ? 'Link: abre pronto no celular do amigo. Arquivo: o amigo importa no app.'
      : 'Envie por Arquivo (o link ainda está sendo configurado).';
    el.bsLink.disabled = !proxyReady();
    el.boardShare.classList.remove('hidden');
  }
  function closeBoardShare() { el.boardShare.classList.add('hidden'); shareTarget = null; }

  function boardToJson(board) { return JSON.stringify(board); }

  // Give an incoming board a fresh id so it doesn't collide with the friend's
  // own boards / progress, and mark where it came from.
  function normalizeSharedBoard(b) {
    if (!b || !b.regions || !b.palette || !b.viewBox) throw new Error('formato inválido');
    b.id = 'shared-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    b.subtitle = 'Recebido de um amigo';
    if (!b.title) b.title = 'Quadro recebido';
    return b;
  }

  function shareBoardFile(board) {
    const fname = String(board.title || 'quadro').replace(/[^\w\-]+/g, '_').slice(0, 40) + '.ccb.json';
    const blob = new Blob([boardToJson(board)], { type: 'application/json' });
    try {
      const file = new File([blob], fname, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: board.title,
          text: 'Joga esse quadro comigo no Cottage Color! 🏡' }).catch(function () {});
        el.bsStatus.textContent = 'Escolha o app para enviar o arquivo. 👍';
        return;
      }
    } catch (_) { /* fall through to download */ }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    el.bsStatus.textContent = 'Arquivo salvo. Envie-o ao seu amigo (ex.: WhatsApp → Documento).';
  }

  function shareBoardLink(board) {
    if (!proxyReady()) { el.bsStatus.textContent = 'O link ainda não foi configurado. Use Salvar arquivo.'; return; }
    el.bsStatus.textContent = 'Gerando link…';
    el.bsLink.disabled = true;
    fetch(proxyBase() + '/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: boardToJson(board)
    }).then(function (r) { return r.json(); }).then(function (d) {
      el.bsLink.disabled = false;
      if (d.error || !d.id) {
        el.bsStatus.textContent = 'Não deu para gerar o link (' + (d.error || 'erro') + '). Use Salvar arquivo.';
        return;
      }
      const link = location.origin + location.pathname + '#play=' + d.id;
      const msg = 'Joga esse quadro comigo no Cottage Color! 🏡\n' + link;
      if (navigator.share) {
        navigator.share({ title: 'Cottage Color', text: msg }).catch(function () {});
        el.bsStatus.textContent = 'Escolha onde enviar o link. 👍';
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function () {
          el.bsStatus.textContent = 'Link copiado! Cole no WhatsApp: ' + link;
        }, function () { el.bsStatus.textContent = link; });
      } else {
        el.bsStatus.textContent = link;
      }
    }).catch(function () {
      el.bsLink.disabled = false;
      el.bsStatus.textContent = 'Falha ao gerar o link. Use Salvar arquivo.';
    });
  }

  // Import a board file a friend sent, then play it.
  function onBoardFileChosen(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = function () {
      try {
        const board = normalizeSharedBoard(JSON.parse(String(r.result || '')));
        addCustomBoard(board);
        buildMenu();
        startBoard(board);
      } catch (err) {
        alert('Não consegui abrir esse arquivo de quadro. Confirme que é o arquivo certo (.ccb.json).');
      }
    };
    r.onerror = function () { alert('Não consegui ler o arquivo.'); };
    r.readAsText(file);
  }

  // Open a shared board from a link (#play=<id>) on load.
  function checkSharedLink() {
    const m = /[#&?]play=([A-Za-z0-9_-]+)/.exec(location.hash || '') ||
              /[?&]play=([A-Za-z0-9_-]+)/.exec(location.search || '');
    if (!m || !proxyReady()) return;
    const id = m[1];
    // clear it so a refresh doesn't re-trigger
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    fetch(proxyBase() + '/board?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (b) {
        if (!b || b.error) { return; }
        const board = normalizeSharedBoard(b);
        addCustomBoard(board);
        buildMenu();
        startBoard(board);
      }).catch(function () {});
  }

  function playUpload() {
    if (!up.board) return;
    up.board.title = customTitle(el.upTitle, 'Minha imagem');
    addCustomBoard(up.board);
    const board = up.board;
    up.img = null; up.board = null;
    closeUpload();
    buildMenu();
    startBoard(board);
  }

  // Read a name field, trimmed, falling back to a default when empty.
  function customTitle(input, fallback) {
    const t = (input && input.value ? input.value : '').trim();
    return t || fallback;
  }

  // =========================================================================
  //  Navigation
  // =========================================================================
  function goToMenu() {
    el.game.classList.add('hidden');
    el.game.classList.remove('complete');
    el.win.classList.add('hidden');
    el.share.classList.add('hidden');
    el.menu.classList.remove('hidden');
    buildMenu();
  }

  // =========================================================================
  //  Wiring
  // =========================================================================
  // First-time "how to play" overlay (shown once).
  const TUT_KEY = STORAGE_PREFIX + 'tut';
  function maybeShowTutorial() {
    let seen = null; try { seen = localStorage.getItem(TUT_KEY); } catch (_) {}
    if (!seen) el.tutorial.classList.remove('hidden');
  }
  function closeTutorial() {
    el.tutorial.classList.add('hidden');
    try { localStorage.setItem(TUT_KEY, '1'); } catch (_) {}
  }

  function init() {
    // Load the custom-board store (IndexedDB) before the first menu render, then
    // handle any shared link (#play=<id>) once the store is ready, then fetch
    // today's "image of the day" and re-render the menu when it arrives.
    loadCustomStore().then(function () {
      buildMenu();
      checkSharedLink();
      initDaily().then(buildMenu);
      if (gg.weeklyUnlocked === String(weekStartIdx())) fetchWeekly();   // restore weekly reward card
    });
    maybeShowTutorial();

    // Gamification: rewards/profile overlay
    el.ggBar.addEventListener('click', openRewards);
    el.rwClose.addEventListener('click', closeRewards);

    // Cloud sync (login) — inert until configured
    cloudInit();

    // Home toolbar: view mode + "only not done" filter + search by name
    Array.prototype.forEach.call(el.menuSort.children, function (btn) {
      btn.addEventListener('click', function () { menuState.sort = btn.dataset.sort; saveMenuState(); buildMenu(); });
    });
    el.menuTodo.addEventListener('change', function () { menuState.onlyTodo = el.menuTodo.checked; saveMenuState(); buildMenu(); });
    el.menuSearch.addEventListener('input', function () { menuQuery = el.menuSearch.value; buildMenu(); });
    el.tutClose.addEventListener('click', closeTutorial);

    el.hintBtn.addEventListener('click', useHint);
    el.seekBtn.addEventListener('click', seekNext);
    el.backBtn.addEventListener('click', goToMenu);
    el.winMenuBtn.addEventListener('click', goToMenu);
    el.winShareBtn.addEventListener('click', openShare);
    el.restartBtn.addEventListener('click', restartBoard);
    el.shareDo.addEventListener('click', doShare);
    el.shareDl.addEventListener('click', doDownload);
    el.shareClose.addEventListener('click', closeShare);
    el.shareBa.addEventListener('change', refreshShareCard);

    // Upload controls
    el.upFile.addEventListener('change', onFileChosen);
    el.upPick.addEventListener('click', pickFile);
    el.upCancel.addEventListener('click', closeUpload);
    el.upPlay.addEventListener('click', playUpload);
    // update the number live while dragging, but only (re)generate on release —
    // fromLineArt is too heavy to run on every slider tick.
    el.upColors.addEventListener('input', function () {
      up.colors = Number(el.upColors.value);
      el.upColorsVal.textContent = up.colors;
    });
    el.upColors.addEventListener('change', function () { if (up.img) regen(); });
    Array.prototype.forEach.call(el.upDetail.children, function (btn) {
      btn.addEventListener('click', function () { setDetail(btn.dataset.detail); regen(); });
    });

    // SVG import controls
    el.svFileBtn.addEventListener('click', function () { el.svFile.value = ''; el.svFile.click(); });
    el.svFile.addEventListener('change', onSvgFileChosen);
    el.svGen.addEventListener('click', svGenerate);
    el.svPlay.addEventListener('click', svPlay);
    el.svCancel.addEventListener('click', closeSvgImport);

    // Web search controls
    el.wsSearchBtn.addEventListener('click', wsSearch);
    el.wsQ.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); wsSearch(); } });
    el.wsBack.addEventListener('click', function () { el.wsMake.classList.add('hidden'); });
    el.wsPlayBtn.addEventListener('click', wsPlay);
    el.wsCancel.addEventListener('click', closeWebSearch);
    // Cores / Dificuldade — update live, regenerate on release (fromLineArt is heavy)
    el.wsColors.addEventListener('input', function () {
      ws.colors = Number(el.wsColors.value);
      el.wsColorsVal.textContent = ws.colors;
    });
    el.wsColors.addEventListener('change', function () { if (ws.img) wsRegen(); });
    Array.prototype.forEach.call(el.wsDetail.children, function (btn) {
      btn.addEventListener('click', function () { wsSetDetail(btn.dataset.detail); if (ws.img) wsRegen(); });
    });

    // Share a playable board / import one from a friend
    el.bsLink.addEventListener('click', function () { if (shareTarget) shareBoardLink(shareTarget); });
    el.bsFile.addEventListener('click', function () { if (shareTarget) shareBoardFile(shareTarget); });
    el.bsClose.addEventListener('click', closeBoardShare);
    el.boardFile.addEventListener('change', onBoardFileChosen);

    el.viewport.addEventListener('pointerdown', onPointerDown);
    el.viewport.addEventListener('pointermove', onPointerMove);
    el.viewport.addEventListener('pointerup', onPointerUp);
    el.viewport.addEventListener('pointercancel', onPointerUp);
    el.viewport.addEventListener('wheel', onWheel, { passive: false });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
