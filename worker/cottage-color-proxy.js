/*
 * Cottage Color — Pixabay proxy (Cloudflare Worker).
 *
 * Why this exists: the browser can't call the Pixabay API directly (no CORS)
 * and shouldn't hold the API key. This tiny Worker:
 *   - keeps the Pixabay key secret (server-side),
 *   - searches Pixabay for ILLUSTRATIONS (the art style the game handles best),
 *   - proxies the chosen image with CORS headers so the game can read its
 *     pixels on a <canvas> without the image becoming "tainted".
 *
 * One-time setup (see worker/README.md for the click-by-click):
 *   1. Get a free Pixabay API key: https://pixabay.com/api/docs/
 *   2. Deploy this file as a Cloudflare Worker.
 *   3. Add a Worker *Secret* named PIXABAY_KEY with your key.
 *
 * Endpoints:
 *   GET /search?q=casa de campo   -> { total, hits: [{ id, thumb, full, tags }] }
 *   GET /img?u=<pixabay img url>  -> the image bytes, CORS-enabled
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS)
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    // ---- Search -----------------------------------------------------------
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ total: 0, hits: [] });
      if (!env.PIXABAY_KEY) {
        return json({ error: 'PIXABAY_KEY não configurada no Worker (adicione o Secret).' }, 500);
      }
      const api = new URL('https://pixabay.com/api/');
      api.searchParams.set('key', env.PIXABAY_KEY);
      api.searchParams.set('q', q);
      api.searchParams.set('image_type', 'illustration'); // best fit for the engine
      api.searchParams.set('safesearch', 'true');
      api.searchParams.set('per_page', '30');
      api.searchParams.set('order', 'popular');

      let data;
      try {
        const r = await fetch(api.toString());
        if (!r.ok) return json({ error: 'Pixabay retornou ' + r.status }, 502);
        data = await r.json();
      } catch (e) {
        return json({ error: 'Falha ao buscar no Pixabay.' }, 502);
      }

      const hits = (data.hits || []).map(function (h) {
        return {
          id: h.id,
          thumb: h.previewURL,                       // ~150px, for the results grid
          full: h.largeImageURL || h.webformatURL,   // up to ~1280px, for the board
          tags: h.tags
        };
      });
      return json({ total: data.totalHits || 0, hits: hits });
    }

    // ---- Image proxy (CORS-clean) -----------------------------------------
    if (url.pathname === '/img') {
      const u = url.searchParams.get('u') || '';
      let target;
      try { target = new URL(u); } catch (_) { return json({ error: 'url inválida' }, 400); }
      // Only ever proxy Pixabay-hosted images — this is not an open proxy.
      if (!/(^|\.)pixabay\.com$/i.test(target.hostname)) {
        return json({ error: 'host não permitido' }, 403);
      }
      let r;
      try { r = await fetch(target.toString()); }
      catch (e) { return json({ error: 'falha ao buscar imagem' }, 502); }
      if (!r.ok) return json({ error: 'imagem retornou ' + r.status }, 502);

      const headers = new Headers(CORS);
      headers.set('Content-Type', r.headers.get('Content-Type') || 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=86400');
      return new Response(r.body, { status: 200, headers: headers });
    }

    // ---- Health check -----------------------------------------------------
    return json({ ok: true, service: 'cottage-color proxy', endpoints: ['/search?q=', '/img?u='] });
  }
};
