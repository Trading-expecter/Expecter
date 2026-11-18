/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * structure.js  (4/11)  ·  Estructura de mercado (BOS / CHoCH)
 * ============================================================ */
window.Structure = (function () {
  'use strict';

  function pivots(bars, lookback) {
    const highs = [], lows = [];
    const lb = Math.max(1, lookback | 0);
    for (let i = lb; i < bars.length - lb; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= lb; j++) {
        if (bars[i].h <= bars[i - j].h || bars[i].h <= bars[i + j].h) isHigh = false;
        if (bars[i].l >= bars[i - j].l || bars[i].l >= bars[i + j].l) isLow = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) highs.push({ index: i, price: bars[i].h });
      if (isLow) lows.push({ index: i, price: bars[i].l });
    }
    return { highs, lows };
  }

  // 1 = alcista (HH+HL), -1 = bajista (LH+LL), 0 = indefinida
  function structureTrend(pivots) {
    const h = pivots.highs, l = pivots.lows;
    if (h.length < 2 || l.length < 2) return 0;
    const lastHigh = h[h.length - 1], prevHigh = h[h.length - 2];
    const lastLow = l[l.length - 1], prevLow = l[l.length - 2];
    const hh = lastHigh.price > prevHigh.price;
    const hl = lastLow.price > prevLow.price;
    const lh = lastHigh.price < prevHigh.price;
    const ll = lastLow.price < prevLow.price;
    if (hh && hl) return 1;
    if (lh && ll) return -1;
    return 0;
  }

  function refBar(bars) {
    if (!bars.length) return null;
    if (CONFIG.smc.requireClosedBreak && bars.length >= 2) return bars[bars.length - 2];
    return bars[bars.length - 1];
  }

  function detectBOS(bars, pivots) {
    const ref = refBar(bars);
    if (!ref) return null;
    const trend = structureTrend(pivots);
    const lastHigh = pivots.highs.length ? pivots.highs[pivots.highs.length - 1] : null;
    const lastLow = pivots.lows.length ? pivots.lows[pivots.lows.length - 1] : null;

    if (trend === 1 && lastHigh && ref.c > lastHigh.price) {
      return { type: 'BOS', direction: 1, level: lastHigh.price, index: lastHigh.index };
    }
    if (trend === -1 && lastLow && ref.c < lastLow.price) {
      return { type: 'BOS', direction: -1, level: lastLow.price, index: lastLow.index };
    }
    if (trend === 0) {
      if (lastHigh && ref.c > lastHigh.price) {
        return { type: 'BOS', direction: 1, level: lastHigh.price, index: lastHigh.index };
      }
      if (lastLow && ref.c < lastLow.price) {
        return { type: 'BOS', direction: -1, level: lastLow.price, index: lastLow.index };
      }
    }
    return null;
  }

  function detectCHoCH(bars, pivots) {
    const ref = refBar(bars);
    if (!ref) return null;
    const trend = structureTrend(pivots);
    const lastHigh = pivots.highs.length ? pivots.highs[pivots.highs.length - 1] : null;
    const lastLow = pivots.lows.length ? pivots.lows[pivots.lows.length - 1] : null;

    if (trend === 1 && lastLow && ref.c < lastLow.price) {
      return { type: 'CHoCH', direction: -1, level: lastLow.price, index: lastLow.index };
    }
    if (trend === -1 && lastHigh && ref.c > lastHigh.price) {
      return { type: 'CHoCH', direction: 1, level: lastHigh.price, index: lastHigh.index };
    }
    return null;
  }

  return { pivots, structureTrend, detectBOS, detectCHoCH };
})();
