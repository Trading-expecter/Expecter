(function (root) {
  'use strict';
  root.AT = root.AT || {};

  const DB_NAME = 'shadow_journal';
  const DB_VERSION = 1;
  const STORE = 'signals';
  const LS_KEY = 'shadow_journal_signals_v1';
  const MAX_SIGNALS = 1000;

  let db = null;
  let useLS = false;
  let initPromise = null;

  function nowISO() { return new Date().toISOString(); }

  function uuid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function makeId(signal) {
    const dir = signal.direction === 1 ? 'buy' : signal.direction === -1 ? 'sell' : 'wait';
    return [signal.symbol || 'UNK', signal.tf || 'tf', signal.ts || Date.now(), dir, uuid()].join('_');
  }

  function num(v) { return v != null && Number.isFinite(v); }

  function openDB() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(false);
    return new Promise(function (resolve) {
      let done = false;
      function finish(ok) { if (!done) { done = true; resolve(ok); } }
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function (e) {
          const d = e.target.result;
          if (!d.objectStoreNames.contains(STORE)) {
            const store = d.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('ts', 'ts', { unique: false });
            store.createIndex('symbol', 'symbol', { unique: false });
            store.createIndex('status', 'outcome.status', { unique: false });
          }
        };
        req.onsuccess = function () { db = req.result; finish(true); };
        req.onerror = function () { finish(false); };
        req.onblocked = function () { finish(false); };
      } catch (e) { finish(false); }
      setTimeout(function () { finish(false); }, 4000);
    });
  }

  function idbPut(rec) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.put(rec);
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGetAll() {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbClear() {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.clear();
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbDelete(id) {
    return new Promise(function (resolve) {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id).onsuccess = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) { resolve(false); }
    });
  }

  function lsRead() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function lsWrite(arr) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      try {
        const half = arr.slice(-Math.floor(arr.length / 2));
        localStorage.setItem(LS_KEY, JSON.stringify(half));
        return true;
      } catch (e2) { return false; }
    }
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = openDB().then(function (ok) {
      useLS = !ok;
      return true;
    }).catch(function () {
      useLS = true;
      return true;
    });
    return initPromise;
  }

  function ensure() { return init(); }

  function pruneIfNeeded() {
    if (useLS) {
      const all = lsRead();
      if (all.length > MAX_SIGNALS) {
        const sorted = all.slice().sort(function (a, b) { return a.ts - b.ts; });
        lsWrite(sorted.slice(all.length - MAX_SIGNALS));
      }
      return Promise.resolve();
    }
    return idbGetAll().then(function (all) {
      if (all.length <= MAX_SIGNALS) return;
      const sorted = all.slice().sort(function (a, b) { return a.ts - b.ts; });
      const excess = sorted.slice(0, all.length - MAX_SIGNALS);
      return Promise.all(excess.map(function (s) { return idbDelete(s.id); }));
    }).catch(function () { void 0; });
  }

  function record(signal) {
    return ensure().then(function () {
      if (!signal || typeof signal !== 'object') throw new Error('señal inválida');
      const rec = Object.assign({}, signal);
      if (!rec.id) rec.id = makeId(rec);
      if (!num(rec.ts)) rec.ts = Date.now();
      if (!rec.iso) rec.iso = new Date(rec.ts).toISOString();
      if (!rec.outcome) {
        rec.outcome = {
          status: 'pending',
          exitTs: null, exitIso: null, exitPrice: null,
          exitBars: null, rMultiple: null, pnlPct: null,
          evaluatedAt: null, reason: 'awaiting'
        };
      }
      rec.recordedAt = Date.now();

      if (useLS) {
        const all = lsRead();
        all.push(rec);
        lsWrite(all);
        return rec.id;
      }
      return idbPut(rec).then(function () { return rec.id; });
    }).then(function (id) {
      pruneIfNeeded().catch(function () { void 0; });
      return id;
    });
  }

  function evalOne(signal, bars) {
    if (!bars || !bars.length) return null;
    const entry = signal.prices && num(signal.prices.entry) ? signal.prices.entry : null;
    const stop  = signal.prices && num(signal.prices.stop)  ? signal.prices.stop  : null;
    const target= signal.prices && num(signal.prices.target)? signal.prices.target: null;
    const dir   = signal.direction;
    if (!num(entry) || !num(stop) || !num(target) || (dir !== 1 && dir !== -1)) {
      return { status: 'invalid', reason: 'missing_levels', exitTs: null, exitPrice: null, exitBars: null, rMultiple: null, pnlPct: null };
    }

    const t0 = signal.ts;
    let barsAfter = 0;
    let lastBar = null;

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (b.t <= t0) continue;
      barsAfter++;
      lastBar = b;

      if (dir === 1) {
        const hitStop = b.l <= stop;
        const hitTarget = b.h >= target;
        if (hitStop && hitTarget) {
          return { status: 'loss', exitTs: b.t, exitPrice: stop, exitBars: barsAfter, rMultiple: -1, pnlPct: ((stop - entry) / entry) * 100, reason: 'ambiguous_conservative' };
        }
        if (hitStop) {
          return { status: 'loss', exitTs: b.t, exitPrice: stop, exitBars: barsAfter, rMultiple: -1, pnlPct: ((stop - entry) / entry) * 100, reason: 'stop_hit' };
        }
        if (hitTarget) {
          const rr = (target - entry) / (entry - stop);
          return { status: 'win', exitTs: b.t, exitPrice: target, exitBars: barsAfter, rMultiple: rr, pnlPct: ((target - entry) / entry) * 100, reason: 'target_hit' };
        }
      } else {
        const hitStop = b.h >= stop;
        const hitTarget = b.l <= target;
        if (hitStop && hitTarget) {
          return { status: 'loss', exitTs: b.t, exitPrice: stop, exitBars: barsAfter, rMultiple: -1, pnlPct: ((entry - stop) / entry) * 100, reason: 'ambiguous_conservative' };
        }
        if (hitStop) {
          return { status: 'loss', exitTs: b.t, exitPrice: stop, exitBars: barsAfter, rMultiple: -1, pnlPct: ((entry - stop) / entry) * 100, reason: 'stop_hit' };
        }
        if (hitTarget) {
          const rr = (entry - target) / (stop - entry);
          return { status: 'win', exitTs: b.t, exitPrice: target, exitBars: barsAfter, rMultiple: rr, pnlPct: ((entry - target) / entry) * 100, reason: 'target_hit' };
        }
      }
    }

    const maxBars = (window.AT_CONFIG && window.AT_CONFIG.risk && window.AT_CONFIG.risk.maxSignalAgeBars) || 8;
    if (barsAfter >= maxBars && lastBar) {
      const mark = lastBar.c;
      const rMark = dir === 1 ? (mark - entry) / (entry - stop) : (entry - mark) / (stop - entry);
      return {
        status: 'open',
        exitTs: null,
        exitPrice: mark,
        exitBars: barsAfter,
        rMultiple: Number.isFinite(rMark) ? rMark : null,
        pnlPct: ((mark - entry) / entry) * 100 * dir,
        reason: 'timeout_' + barsAfter + 'bars'
      };
    }

    return null;
  }

  function updateOutcomes(barsByTf, opts) {
    opts = opts || {};
    const filterSymbol = opts.symbol || null;
    return ensure().then(function () {
      const source = useLS ? Promise.resolve(lsRead()) : idbGetAll();
      return source.then(function (all) {
        const pending = all.filter(function (s) {
          const st = s.outcome && s.outcome.status;
          if (st !== 'pending' && st !== 'open') return false;
          if (filterSymbol && s.symbol !== filterSymbol) return false;
          return true;
        });
        if (!pending.length) return 0;

        let updated = 0;
        const persist = [];

        for (let i = 0; i < pending.length; i++) {
          const sig = pending[i];
          const bars = barsByTf && barsByTf[sig.tf];
          if (!bars || !bars.length) continue;
          const res = evalOne(sig, bars);
          if (!res) continue;
          if (res.status === 'invalid' && (!sig.outcome || sig.outcome.status === 'invalid')) continue;
          sig.outcome = Object.assign({}, sig.outcome || {}, res, {
            evaluatedAt: Date.now(),
            exitIso: res.exitTs ? new Date(res.exitTs).toISOString() : null
          });
          persist.push(sig);
          updated++;
        }

        if (!persist.length) return 0;

        if (useLS) {
          const all2 = lsRead();
          const map = {};
          persist.forEach(function (p) { map[p.id] = p; });
          for (let i = 0; i < all2.length; i++) {
            if (map[all2[i].id]) all2[i] = map[all2[i].id];
          }
          lsWrite(all2);
          return updated;
        }

        return Promise.all(persist.map(function (p) { return idbPut(p).catch(function () { return false; }); }))
          .then(function () { return updated; });
      });
    }).catch(function (e) {
      console.warn('[journal] updateOutcomes error:', e);
      return 0;
    });
  }

  function getAll() {
    return ensure().then(function () {
      const source = useLS ? Promise.resolve(lsRead()) : idbGetAll();
      return source.then(function (arr) {
        return arr.slice().sort(function (a, b) { return a.ts - b.ts; });
      });
    });
  }

  function stats() {
    return getAll().then(function (all) {
      let wins = 0, losses = 0, open = 0, pending = 0, invalid = 0;
      let sumRWin = 0, sumRLoss = 0, totalR = 0;

      for (let i = 0; i < all.length; i++) {
        const o = all[i].outcome || {};
        const st = o.status;
        if (st === 'win') { wins++; if (num(o.rMultiple)) sumRWin += o.rMultiple; totalR += num(o.rMultiple) ? o.rMultiple : 0; }
        else if (st === 'loss') { losses++; sumRLoss += 1; totalR -= 1; }
        else if (st === 'open') open++;
        else if (st === 'invalid') invalid++;
        else pending++;
      }

      const closed = wins + losses;
      const winRate = closed > 0 ? (wins / closed) * 100 : 0;
      const avgWinR = wins > 0 ? sumRWin / wins : 0;
      const avgLossR = losses > 0 ? sumRLoss / losses : 0;
      const expectancyR = closed > 0 ? (wins / closed) * avgWinR - (losses / closed) * avgLossR : 0;
      const profitFactor = sumRLoss > 0 ? (sumRWin / sumRLoss) : (sumRWin > 0 ? Infinity : 0);

      return {
        total: all.length, closed, wins, losses, open, pending, invalid,
        winRate, avgWinR, avgLossR, expectancyR, profitFactor, totalR
      };
    });
  }

  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function timestampName(ext) {
    const d = new Date();
    const p = function (n) { return ('0' + n).slice(-2); };
    return 'shadow_journal_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + ext;
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 200);
  }

  function exportJSON() {
    return getAll().then(function (all) {
      const payload = {
        exportedAt: nowISO(),
        version: '1.0',
        count: all.length,
        signals: all
      };
      download(timestampName('json'), JSON.stringify(payload, null, 2), 'application/json');
      return all.length;
    });
  }

  function exportCSV() {
    return getAll().then(function (all) {
      const headers = [
        'id', 'ts', 'iso', 'symbol', 'tf', 'direction', 'action',
        'entry', 'stop', 'target', 'rr',
        'score', 'confidence', 'consensusScore', 'consensusLabel',
        'verdictState', 'verdictLabel',
        'multiTfAction', 'multiTfStrength', 'multiTfAlignment',
        'smcScore', 'smcGrade', 'smcTrend',
        'bd_mss', 'bd_sweep', 'bd_fvg', 'bd_ob', 'bd_ote', 'bd_htfBias', 'bd_penalty',
        'anticipation_type', 'anticipation_score', 'anticipation_strength',
        'sessionLabel', 'marketOpen', 'highLiquidity',
        'macroTrend', 'macroMomentum', 'macroVolatility',
        'outcome_status', 'exitTs', 'exitIso', 'exitPrice', 'exitBars', 'rMultiple', 'pnlPct', 'outcomeReason'
      ];

      const rows = [headers.join(',')];

      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        const v = s.verdict || {};
        const mtf = s.multiTfSignal || {};
        const smc = s.smc || {};
        const bd = smc.breakdown || {};
        const ant = s.anticipation || {};
        const sn = (s.snapshot && s.snapshot.context) || {};
        const prices = s.prices || {};
        const o = s.outcome || {};
        const f = function (k) { return bd[k] && num(bd[k].weighted) ? bd[k].weighted.toFixed(2) : ''; };

        rows.push([
          csvCell(s.id), csvCell(s.ts), csvCell(s.iso), csvCell(s.symbol), csvCell(s.tf), csvCell(s.direction), csvCell(s.action),
          csvCell(prices.entry), csvCell(prices.stop), csvCell(prices.target), csvCell(prices.rr),
          csvCell(v.score != null ? v.score : s.consensusScore), csvCell(v.confidence != null ? v.confidence : s.confidence),
          csvCell(v.consensusScore), csvCell(v.consensusLabel),
          csvCell(v.state), csvCell(v.label),
          csvCell(mtf.action), csvCell(mtf.strength), csvCell(mtf.alignment),
          csvCell(smc.score), csvCell(smc.grade), csvCell(smc.trend),
          csvCell(f('mss')), csvCell(f('sweep')), csvCell(f('fvg')), csvCell(f('ob')), csvCell(f('ote')), csvCell(f('htfBias')), csvCell(f('penalty')),
          csvCell(ant.type), csvCell(ant.score), csvCell(ant.strength),
          csvCell(sn.sessionLabel), csvCell(sn.marketOpen), csvCell(sn.highLiquidity),
          csvCell(sn.macroTrend), csvCell(sn.macroMomentum), csvCell(sn.macroVolatility),
          csvCell(o.status), csvCell(o.exitTs), csvCell(o.exitIso), csvCell(o.exitPrice), csvCell(o.exitBars), csvCell(o.rMultiple), csvCell(o.pnlPct), csvCell(o.reason)
        ].join(','));
      }

      download(timestampName('csv'), rows.join('\n'), 'text/csv;charset=utf-8');
      return all.length;
    });
  }

  function clear() {
    return ensure().then(function () {
      if (useLS) { try { localStorage.removeItem(LS_KEY); } catch (e) { void 0; } return true; }
      return idbClear();
    });
  }

  function isReady() { return initPromise !== null; }
  function isFallback() { return useLS; }
  function maxSignals() { return MAX_SIGNALS; }

  root.AT.journal = {
    init,
    record,
    updateOutcomes,
    getAll,
    stats,
    exportJSON,
    exportCSV,
    clear,
    isReady,
    isFallback,
    maxSignals
  };

})(typeof self !== 'undefined' ? self : this);