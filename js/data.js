/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * data.js  (3/11)  ·  Capa de datos (biquote.io REST + SignalR)
 * Docs: https://biquote.io/docs/
 * ============================================================ */
window.Data = (function () {
  'use strict';

  const TF_MS = {
    '1m': 60000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000
  };

  const base = () => CONFIG.feed.base;
  const feedCfg = () => CONFIG.feed;

  function parseTs(x) {
    if (x == null) return null;
    if (typeof x === 'number') return x < 1e12 ? x * 1000 : x;
    const t = Date.parse(x);
    return Number.isFinite(t) && t > 0 ? t : null;
  }

  function num(x) {
    if (x == null || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function normBar(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = parseTs(raw.openTime);
    const o = num(raw.open), h = num(raw.high), l = num(raw.low), c = num(raw.close);
    if (t == null || o == null || h == null || l == null || c == null) return null;
    if (h < Math.max(o, c) || l > Math.min(o, c)) return null;
    return { t, o, h, l, c, v: num(raw.tickVolume) || num(raw.volume) || 0, live: !!raw.isOpen };
  }

  // biquote devuelve newest-first: dedupe por openTime y ordena ascendente.
  function normalizeBars(arr) {
    const map = new Map();
    for (const raw of arr) {
      const b = normBar(raw);
      if (b) map.set(b.t, b);
    }
    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }

  async function getJSON(path, attempt = 1) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), feedCfg().fetchTimeout);
    try {
      const r = await fetch(base() + path, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (r.status === 429) {
        const wait = Number(r.headers.get('Retry-After')) || 60;
        await new Promise(res => setTimeout(res, Math.min(wait, 60) * 1000));
        if (attempt < feedCfg().maxRetries) return getJSON(path, attempt + 1);
        throw new Error('Rate limit (429)');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      clearTimeout(timer);
      if (attempt < feedCfg().maxRetries && (e.name === 'TypeError' || e.name === 'AbortError')) {
        await new Promise(res => setTimeout(res, feedCfg().retryBackoffMs * attempt));
        return getJSON(path, attempt + 1);
      }
      throw e;
    }
  }

  async function fetchBars(symbol, tf, limit = 200) {
    const path = '/api/' + encodeURIComponent(symbol) +
      '/ohlc?interval=' + encodeURIComponent(tf) +
      '&limit=' + Math.min(1000, Math.max(1, limit));
    const d = await getJSON(path);
    const arr = Array.isArray(d) ? d : (d && Array.isArray(d.bars) ? d.bars : []);
    const bars = normalizeBars(arr);
    if (!bars.length) throw new Error('Sin datos OHLC para ' + symbol + ' ' + tf);
    return bars;
  }

  // 'last' y 'volume' son siempre 0 en MT5/CFD: usar mid (o bid/ask).
  function normTick(raw) {
    if (!raw || !raw.symbol) return null;
    const bid = num(raw.bid), ask = num(raw.ask);
    const mid = num(raw.mid) || (bid && ask ? (bid + ask) / 2 : null);
    if (!mid || mid <= 0) return null;
    return {
      symbol: String(raw.symbol).toUpperCase(),
      description: raw.description || '',
      mid, bid: bid || mid, ask: ask || mid,
      spread: num(raw.spread),
      dayPct: num(raw.dayDiffPercent),
      direction: raw.direction || 'FLAT',
      state: raw.marketState || 'open',
      stale: !!raw.stale,
      quoteAgeSeconds: num(raw.quoteAgeSeconds) || 0,
      ts: parseTs(raw.timestamp) || Date.now()
    };
  }

  // Batch de ticks (UNA llamada). Devuelve objeto {SYMBOL: tick}.
  async function fetchLatest(symbols) {
    const q = symbols.map(s => 'symbols=' + encodeURIComponent(s)).join('&');
    const d = await getJSON('/api/latest?' + q);
    const out = {};
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const [sym, raw] of Object.entries(d)) {
        const t = normTick(raw);
        if (t) out[t.symbol] = t;
      }
    }
    return out;
  }

  function applyTick(bars, tfMs, price, ts) {
    if (!bars || !bars.length || !Number.isFinite(price) || price <= 0) return;
    const last = bars[bars.length - 1];
    const bucket = Math.floor(ts / tfMs) * tfMs;
    const lastBucket = Math.floor(last.t / tfMs) * tfMs;
    if (bucket > lastBucket) {
      last.live = false;
      bars.push({ t: bucket, o: price, h: price, l: price, c: price, v: 1, live: true });
    } else if (bucket === lastBucket) {
      last.live = true;
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
      last.c = price;
      last.v += 1;
    }
  }

  function createFeed(symbols, handlers) {
    let conn = null, pollTimer = null, mode = 'off', stopped = false;

    function setMode(m) { mode = m; if (handlers.status) handlers.status(m); }

    function emitTicks(map) {
      if (!handlers.tick) return;
      for (const sym of symbols) { const t = map[sym]; if (t) handlers.tick(t); }
    }

    async function poll() {
      if (stopped) return;
      try {
        emitTicks(await fetchLatest(symbols));
        if (mode !== 'live') setMode('polling');
      } catch (e) { if (mode !== 'live') setMode('error'); }
    }

    async function startSignalR() {
      if (!window.signalR) return false;
      try {
        conn = new signalR.HubConnectionBuilder()
          .withUrl(base() + '/hubs/tick')
          .withAutomaticReconnect()
          .build();

        conn.on('ReceiveTick', raw => {
          const t = normTick(raw);
          if (t && handlers.tick) handlers.tick(t);
        });

        // Distingue cerrado / desconocido / muerto.
        conn.on('ReceiveSubscriptionState', states => {
          if (handlers.subscriptionState) handlers.subscriptionState(states);
        });

        conn.onreconnected(() => {
          if (stopped) return;
          conn.invoke('Subscribe', symbols).then(() => setMode('live')).catch(() => {});
        });

        await conn.start();
        await conn.invoke('Subscribe', symbols);
        setMode('live');
        return true;
      } catch (e) { conn = null; return false; }
    }

    return {
      async start() {
        stopped = false;
        try { emitTicks(await fetchLatest(symbols)); } catch (e) {}
        setMode('polling');
        pollTimer = setInterval(poll, feedCfg().pollMs);
        poll();
        if (feedCfg().preferSignalR) startSignalR();
      },
      stop() {
        stopped = true;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (conn) { try { conn.stop(); } catch (e) {} conn = null; }
        setMode('off');
      }
    };
  }

  return { TF: TF_MS, fetchBars, fetchLatest, applyTick, createFeed };
})();
