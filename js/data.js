(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else { root.AT = root.AT || {}; root.AT.data = factory(root); }
}(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const G = typeof globalThis !== 'undefined' ? globalThis : root;

  const TF_MS = {
    '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
    '1h': 3600000, '4h': 14400000, '1d': 86400000
  };

  function cfg() { return G.AT_CONFIG || {}; }
  function feedCfg() { return cfg().feed || {}; }
  function base() { return cfg().base || 'https://biquote.io'; }

  function toNum(x) {
    if (x == null || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }

  function parseTs(x) {
    if (x == null) return null;
    if (typeof x === 'number' && Number.isFinite(x)) {
      return x < 1e12 ? x * 1000 : x;
    }
    const t = Date.parse(x);
    return Number.isFinite(t) && t > 0 ? t : null;
  }

  function isRetryable(e) {
    if (!e || e.aborted) return false;
    if (e.network || e.timeout) return true;
    if (e.status === 429) return true; // IMPORTANTE: Reintentar bloqueos de la API
    return e.status >= 500 && e.status < 600;
  }

  function getJSON(path, timeoutMs, attempt, externalSignal) {
    const timeout = timeoutMs || feedCfg().fetchTimeout || 8000;
    const maxAttempts = feedCfg().maxRetries || 3;
    attempt = attempt || 1;

    if (externalSignal && externalSignal.aborted) {
      const e = new Error('aborted'); e.aborted = true;
      return Promise.reject(e);
    }

    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let reason = null;
    let timer = null;

    if (ctl) {
      timer = setTimeout(function () { reason = 'timeout'; ctl.abort(); }, timeout);
    }

    function onExternalAbort() { reason = 'external'; if (ctl) ctl.abort(); }
    if (externalSignal && ctl) externalSignal.addEventListener('abort', onExternalAbort, { once: true });

    const opts = ctl ? { signal: ctl.signal, cache: 'no-store' } : { cache: 'no-store' };

    return G.fetch(base() + path, opts).then(function (r) {
      if (timer) clearTimeout(timer);
      if (externalSignal && ctl) externalSignal.removeEventListener('abort', onExternalAbort);
      if (!r.ok) {
        const e = new Error('HTTP ' + r.status + ' en ' + path);
        e.status = r.status;
        e.retryAfter = Number(r.headers.get('Retry-After')) || 0;
        throw e;
      }
      return r.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (externalSignal && ctl) externalSignal.removeEventListener('abort', onExternalAbort);
      if (reason === 'external') { const e = new Error('aborted'); e.aborted = true; throw e; }
      if (reason === 'timeout') { const e = new Error('timeout ' + timeout + 'ms'); e.timeout = true; throw e; }
      const e = new Error(err && err.message || 'network error');
      e.network = true;
      throw e;
    }).catch(function (e) {
      if (e && e.aborted) throw e;
      if (attempt < maxAttempts && isRetryable(e)) {
        let delay = Math.min(2000, Math.pow(2, attempt - 1) * 300) + Math.random() * 200;
        
        // Si la API nos bloquea (429), esperamos obligatoriamente 4 segundos
        if (e.status === 429) {
          delay = e.retryAfter > 0 ? e.retryAfter * 1000 : 4000;
        }

        return new Promise(function (res) { setTimeout(res, delay); })
          .then(function () { return getJSON(path, timeoutMs, attempt + 1, externalSignal); });
      }
      throw e;
    });
  }

  function normBar(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const t = parseTs(raw.openTime);
    const o = toNum(raw.open), h = toNum(raw.high), l = toNum(raw.low), c = toNum(raw.close);
    if (t == null || o == null || h == null || l == null || c == null) return null;
    if (h < l || o <= 0 || h <= 0 || l <= 0 || c <= 0) return null;
    const v = toNum(raw.tickVolume);
    return { t, o, h, l, c, v: v != null ? v : (toNum(raw.volume) || 0), live: !!raw.isOpen };
  }

  function normalizeBars(arr) {
    const seen = new Map();
    for (let i = 0; i < arr.length; i++) {
      const b = normBar(arr[i]);
      if (b) seen.set(b.t, b);
    }
    return Array.from(seen.values()).sort(function (a, b) { return a.t - b.t; });
  }

  function fetchBars(symbol, tf, limit, signal) {
    const path = '/api/' + encodeURIComponent(symbol) + '/ohlc?interval=' + tf + '&limit=' + (limit || 500);
    return getJSON(path, null, 1, signal).then(function (d) {
      const arr = Array.isArray(d) ? d : (d && Array.isArray(d.bars) ? d.bars : []);
      const bars = normalizeBars(arr);
      if (!bars.length) { const e = new Error('sin datos para ' + symbol); e.status = 404; throw e; }
      return bars;
    });
  }

  function normTick(raw) {
    if (!raw || typeof raw !== 'object' || !raw.symbol) return null;
    const bid = toNum(raw.bid), ask = toNum(raw.ask);
    const mid = toNum(raw.mid) || (bid != null && ask != null ? (bid + ask) / 2 : null);
    if (mid == null || mid <= 0) return null;
    const ts = parseTs(raw.timestamp) || Date.now();
    return {
      symbol: String(raw.symbol).toUpperCase(),
      bid: bid != null && bid > 0 ? bid : mid,
      ask: ask != null && ask > 0 ? ask : mid,
      mid,
      spread: toNum(raw.spread) || (bid != null && ask != null ? Math.max(0, ask - bid) : 0),
      ts,
      dayPct: toNum(raw.dayDiffPercent),
      state: raw.marketState || 'open',
      stale: !!raw.stale
    };
  }

  function parseLatest(d) {
    let arr;
    if (Array.isArray(d)) arr = d;
    else if (d && Array.isArray(d.ticks)) arr = d.ticks;
    else if (d && typeof d === 'object') {
      arr = Object.keys(d).map(function (k) { return d[k] && typeof d[k] === 'object' ? Object.assign({ symbol: k }, d[k]) : null; });
    } else arr = [];
    return arr.map(normTick).filter(Boolean);
  }

  function fetchLatest(symbols, signal) {
    if (!symbols || !symbols.length) return Promise.resolve([]);
    const q = symbols.map(function (s) { return 'symbols=' + encodeURIComponent(s); }).join('&');
    return getJSON('/api/latest?' + q, null, 1, signal).then(parseLatest);
  }

  function pool(tasks, limit, globalTimeoutMs) {
    if (!tasks || !tasks.length) return Promise.resolve([]);
    const results = new Array(tasks.length);
    let next = 0;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const signal = ctl ? ctl.signal : null;

    const cfgLimit = feedCfg().maxConcurrent;
    const effectiveLimit = Math.max(1, Math.min(
      (typeof limit === 'number' && limit > 0) ? limit : 1,
      (typeof cfgLimit === 'number' && cfgLimit > 0) ? cfgLimit : 1,
      tasks.length
    ));

    function worker() {
      if (next >= tasks.length || (signal && signal.aborted)) return Promise.resolve();
      const idx = next++;
      return Promise.resolve()
        .then(function () { return tasks[idx](signal); })
        .then(
          function (v) { results[idx] = { ok: true, v }; },
          function (e) { results[idx] = { ok: false, e }; }
        )
        .then(worker);
    }

    const workers = [];
    for (let i = 0; i < effectiveLimit; i++) workers.push(worker());
    const run = Promise.all(workers).then(function () { return results; });

    if (!globalTimeoutMs) return run;

    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        if (ctl) ctl.abort();
        const err = new Error('pool timeout'); err.timeout = true; err.partial = results.slice();
        reject(err);
      }, globalTimeoutMs);
      run.then(function (r) { clearTimeout(timer); resolve(r); },
              function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function applyTick(bars, tfMs, price, ts, volume) {
    if (!bars || !bars.length || !Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(ts) || !Number.isFinite(tfMs) || tfMs <= 0) return null;

    const last = bars[bars.length - 1];
    const vol = Number.isFinite(volume) && volume >= 0 ? volume : 1;
    const currentBucket = Math.floor(ts / tfMs) * tfMs;
    const lastBucket = Math.floor(last.t / tfMs) * tfMs;

    if (currentBucket > lastBucket) {
      last.live = false;
      bars.push({ t: currentBucket, o: price, h: price, l: price, c: price, v: vol, live: true });
      return (currentBucket - lastBucket) > tfMs ? 'gap' : 'new';
    }

    if (ts < last.t) return null;

    last.live = true;
    if (price > last.h) last.h = price;
    if (price < last.l) last.l = price;
    last.c = price;
    last.v += vol;
    return 'upd';
  }

  function createFeed(symbols, handlers) {
    handlers = handlers || {};

    const pollMs = feedCfg().pollMs || 2000;
    const pollSlowMs = feedCfg().pollSlowMs || 20000;
    const staleMs = feedCfg().staleThresholdMs || 15000;
    const wsBaseMs = feedCfg().wsReconnectMs || 3000;
    const wsMaxMs = feedCfg().wsMaxReconnectMs || 30000;

    let conn = null;
    let pollTimer = null;
    let staleTimer = null;
    let mode = 'off';
    let backoffUntil = 0;
    let stopped = true;
    let pollInFlight = false;
    let lastTickAt = 0;
    let lastError = null;
    let staleEmitted = false;
    let wsAttempt = 0;
    const paused = {};

    function active() {
      const now = Date.now();
      return symbols.filter(function (s) { return !(paused[s] > now); });
    }

    function setMode(m, err) {
      if (m === mode && !err) return;
      mode = m;
      if (err) lastError = err;
      if (handlers.status) handlers.status(m, err || lastError);
    }

    function emit(arr) {
      if (!arr || !arr.length) return;
      lastTickAt = Date.now();
      staleEmitted = false;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (paused[t.symbol]) delete paused[t.symbol];
        if (handlers.tick) handlers.tick(t);
      }
    }

    function checkStale() {
      if (stopped || !lastTickAt) return;
      const age = Date.now() - lastTickAt;
      if (age > staleMs && !staleEmitted) {
        staleEmitted = true;
        if (handlers.status) handlers.status('stale', lastError);
      }
    }

    function poll() {
      if (stopped || pollInFlight || Date.now() < backoffUntil) return Promise.resolve();
      if (!active().length) return Promise.resolve();
      pollInFlight = true;

      return fetchLatest(active()).then(function (arr) {
        pollInFlight = false;
        emit(arr);
        if (mode === 'off' || mode === 'reconnecting') setMode('polling');
      }, function (e) {
        pollInFlight = false;
        if (e && e.status === 429) {
          backoffUntil = Date.now() + (e.retryAfter || 60) * 1000;
          return;
        }
        if (mode !== 'live') setMode('error', e);
      });
    }

    function startPolling(ms) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(function () { poll().catch(function () { void 0; }); }, ms);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function loadSignalRClient() {
      return new Promise(function (resolve) {
        if (G.signalR) { resolve(true); return; }
        const s = document.createElement('script');
        s.src = cfg().signalrUrl;
        s.onload = function () { resolve(!!G.signalR); };
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
      });
    }

    function wsDelay() {
      return Math.min(wsMaxMs, wsBaseMs * Math.pow(2, wsAttempt)) + Math.random() * 500;
    }

    function connectWS() {
      if (stopped || !G.signalR) return Promise.resolve(false);

      return new Promise(function (resolve) {
        let done = false;
        function finish(ok) { if (!done) { done = true; resolve(ok); } }

        try {
          conn = new G.signalR.HubConnectionBuilder()
            .withUrl(base() + '/hubs/tick', { withCredentials: false })
            .withAutomaticReconnect({ nextRetryDelayInMilliseconds: function () { return wsDelay(); } })
            .build();

          conn.on('ReceiveTick', function (raw) {
            const t = normTick(raw);
            if (t) emit([t]);
          });

          conn.onreconnecting(function () {
            setMode('reconnecting');
            startPolling(pollMs);
          });

          conn.onreconnected(function () {
            wsAttempt = 0;
            conn.invoke('Subscribe', active())
              .then(function () { setMode('live'); startPolling(pollSlowMs); })
              .catch(function () { setMode('polling'); startPolling(pollMs); });
          });

          conn.onclose(function () {
            if (stopped) return;
            wsAttempt++;
            setMode('polling');
            startPolling(pollMs);
            setTimeout(function () { if (!stopped) connectWS(); }, wsDelay());
          });

          const timeoutP = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('ws timeout')); }, 5000); });

          Promise.race([conn.start(), timeoutP])
            .then(function () { return conn.invoke('Subscribe', active()); })
            .then(function () {
              wsAttempt = 0;
              setMode('live');
              startPolling(pollSlowMs);
              finish(true);
            })
            .catch(function () {
              try { if (conn) conn.stop(); } catch (e) { void 0; }
              conn = null;
              finish(false);
            });
        } catch (e) {
          conn = null;
          finish(false);
        }
      });
    }

    function start() {
      stopped = false;
      setMode('polling');
      if (!pollTimer) startPolling(pollMs);
      poll().catch(function () { void 0; });

      if (!staleTimer) {
        staleTimer = setInterval(checkStale, Math.max(2000, Math.floor(staleMs / 2)));
      }

      loadSignalRClient().then(function (ok) {
        if (!ok || !feedCfg().wsEnabled) return false;
        return connectWS();
      });
    }

    function stop() {
      stopped = true;
      stopPolling();
      if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
      if (conn) { try { conn.stop(); } catch (e) { void 0; } conn = null; }
      setMode('off');
    }

    return {
      start,
      stop,
      mode: function () { return mode; },
      lastTickAt: function () { return lastTickAt; }
    };
  }

  return {
    TF: TF_MS,
    fetchBars,
    fetchLatest,
    pool,
    applyTick,
    createFeed
  };
}));