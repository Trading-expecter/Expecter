window.AT = window.AT || {};
window.AT.smc = window.AT.smc || {};

window.AT.smc.structure = (function (I) {
  'use strict';

  const DEFAULT_LOOKBACK = 5;
  const DEFAULT_MSS_WINDOW = 15;
  const PIVOT_TOLERANCE_ATR_MULT = 0.10;
  const MIN_PIVOT_STRENGTH = 0.2;
  const MIN_BODY_ATR_MULT = 0.3;

  function cfg() {
    return (window.AT_CONFIG && window.AT_CONFIG.smc) || {};
  }

  function lookbackDefault() {
    return cfg().pivotLookback || DEFAULT_LOOKBACK;
  }

  function mssWindowDefault() {
    return cfg().mssWindow || DEFAULT_MSS_WINDOW;
  }

  function toleranceFor(bars) {
    if (!bars || bars.length < 2) return 0;
    let sum = 0;
    const n = Math.min(bars.length - 1, 14);
    for (let i = bars.length - n; i < bars.length; i++) {
      sum += Math.abs(bars[i].h - bars[i].l);
    }
    return (sum / n) * PIVOT_TOLERANCE_ATR_MULT;
  }

  function computeAtrInternal(bars) {
    if (!I || typeof I.atr !== 'function') return 0;
    if (!bars || bars.length < 15) return 0;
    const highs = bars.map(function (b) { return b.h; });
    const lows = bars.map(function (b) { return b.l; });
    const closes = bars.map(function (b) { return b.c; });
    const arr = I.atr(highs, lows, closes, 14);
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (v != null && Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  function findPivots(bars, lookback) {
    const L = lookback || lookbackDefault();
    const highs = [];
    const lows = [];
    if (!bars || bars.length < 2 * L + 1) return { highs: highs, lows: lows };

    const tol = toleranceFor(bars);
    const firstPossible = L;
    const lastPossible = bars.length - L - 1;

    for (let i = firstPossible; i <= lastPossible; i++) {
      const b = bars[i];
      let isHigh = true;
      let isLow = true;
      let maxNearHigh = -Infinity;
      let minNearLow = Infinity;

      for (let j = 1; j <= L; j++) {
        const left = bars[i - j];
        const right = bars[i + j];

        if (isHigh && (left.h > b.h + tol || right.h > b.h + tol)) isHigh = false;
        if (isLow && (left.l < b.l - tol || right.l < b.l - tol)) isLow = false;

        if (left.h > maxNearHigh) maxNearHigh = left.h;
        if (right.h > maxNearHigh) maxNearHigh = right.h;
        if (left.l < minNearLow) minNearLow = left.l;
        if (right.l < minNearLow) minNearLow = right.l;
      }

      if (isHigh) {
        const prom = b.h - maxNearHigh;
        const strength = tol > 0 ? Math.max(0, Math.min(1, prom / (tol * 2))) : 1;
        highs.push({ index: i, price: b.h, strength: strength, confirmedIndex: i + L });
      }

      if (isLow) {
        const prom = minNearLow - b.l;
        const strength = tol > 0 ? Math.max(0, Math.min(1, prom / (tol * 2))) : 1;
        lows.push({ index: i, price: b.l, strength: strength, confirmedIndex: i + L });
      }
    }

    return { highs: highs, lows: lows };
  }

  function previousTrend(bars, pivots, upToIndex) {
    if (!pivots || !pivots.highs.length || !pivots.lows.length) return 0;
    let lastHigh = null;
    let lastLow = null;
    for (let i = pivots.highs.length - 1; i >= 0; i--) {
      if (pivots.highs[i].index < upToIndex) { lastHigh = pivots.highs[i]; break; }
    }
    for (let i = pivots.lows.length - 1; i >= 0; i--) {
      if (pivots.lows[i].index < upToIndex) { lastLow = pivots.lows[i]; break; }
    }
    if (!lastHigh || !lastLow) return 0;
    return lastHigh.index > lastLow.index ? 1 : -1;
  }

  function findBreakoutBar(bars, fromIdx, level, direction) {
    for (let i = fromIdx + 1; i < bars.length; i++) {
      const b = bars[i];
      if (direction === 1 && b.c > level) return i;
      if (direction === -1 && b.c < level) return i;
    }
    return -1;
  }

  function isInvalidated(bars, breakoutIdx, level, direction) {
    for (let i = breakoutIdx + 1; i < bars.length; i++) {
      const b = bars[i];
      if (direction === 1 && b.c < level) return true;
      if (direction === -1 && b.c > level) return true;
    }
    return false;
  }

  function detectMSS(bars, pivots, opts) {
    opts = opts || {};
    if (!bars || bars.length < 3) return null;
    if (!pivots || !pivots.highs.length || !pivots.lows.length) return null;

    const window = opts.window || mssWindowDefault();
    const lastBarIndex = bars.length - 1;
    const lastClose = bars[lastBarIndex].c;
    const atr = opts.atr != null ? opts.atr : computeAtrInternal(bars);

    let bullishPivot = null;
    let bearishPivot = null;

    for (let i = pivots.highs.length - 1; i >= 0; i--) {
      const h = pivots.highs[i];
      if (h.index >= lastBarIndex - window && h.index < lastBarIndex) {
        bullishPivot = h;
        break;
      }
    }
    for (let i = pivots.lows.length - 1; i >= 0; i--) {
      const l = pivots.lows[i];
      if (l.index >= lastBarIndex - window && l.index < lastBarIndex) {
        bearishPivot = l;
        break;
      }
    }

    if (bullishPivot && bullishPivot.strength >= MIN_PIVOT_STRENGTH && lastClose > bullishPivot.price) {
      const prevTrend = previousTrend(bars, pivots, bullishPivot.index);
      if (prevTrend === 0) return null;

      const breakoutIdx = findBreakoutBar(bars, bullishPivot.index, bullishPivot.price, 1);
      if (breakoutIdx < 0) return null;

      if (atr > 0) {
        const breakoutBar = bars[breakoutIdx];
        const body = Math.abs(breakoutBar.c - breakoutBar.o);
        if (body < MIN_BODY_ATR_MULT * atr) return null;
      }

      if (isInvalidated(bars, breakoutIdx, bullishPivot.price, 1)) return null;

      const isMSS = prevTrend === -1;
      return {
        direction: 1,
        level: bullishPivot.price,
        index: bullishPivot.index,
        breakoutIndex: breakoutIdx,
        barsSince: lastBarIndex - breakoutIdx,
        type: isMSS ? 'MSS_Bullish' : 'BOS_Bullish',
        fresh: (lastBarIndex - breakoutIdx) <= window,
        strength: bullishPivot.strength,
        bodyAtr: atr > 0 ? Math.abs(bars[breakoutIdx].c - bars[breakoutIdx].o) / atr : 0
      };
    }

    if (bearishPivot && bearishPivot.strength >= MIN_PIVOT_STRENGTH && lastClose < bearishPivot.price) {
      const prevTrend = previousTrend(bars, pivots, bearishPivot.index);
      if (prevTrend === 0) return null;

      const breakoutIdx = findBreakoutBar(bars, bearishPivot.index, bearishPivot.price, -1);
      if (breakoutIdx < 0) return null;

      if (atr > 0) {
        const breakoutBar = bars[breakoutIdx];
        const body = Math.abs(breakoutBar.c - breakoutBar.o);
        if (body < MIN_BODY_ATR_MULT * atr) return null;
      }

      if (isInvalidated(bars, breakoutIdx, bearishPivot.price, -1)) return null;

      const isMSS = prevTrend === 1;
      return {
        direction: -1,
        level: bearishPivot.price,
        index: bearishPivot.index,
        breakoutIndex: breakoutIdx,
        barsSince: lastBarIndex - breakoutIdx,
        type: isMSS ? 'MSS_Bearish' : 'BOS_Bearish',
        fresh: (lastBarIndex - breakoutIdx) <= window,
        strength: bearishPivot.strength,
        bodyAtr: atr > 0 ? Math.abs(bars[breakoutIdx].c - bars[breakoutIdx].o) / atr : 0
      };
    }

    return null;
  }

  function detectStructure(bars, opts) {
    opts = opts || {};
    const lookback = opts.lookback || lookbackDefault();
    const window = opts.window || mssWindowDefault();
    const atr = opts.atr != null ? opts.atr : computeAtrInternal(bars);
    const pivots = findPivots(bars, lookback);
    const mss = detectMSS(bars, pivots, { window: window, atr: atr });
    return {
      pivots: pivots,
      mss: mss,
      trend: mss ? mss.direction : 0,
      atr: atr
    };
  }

  return {
    findPivots: findPivots,
    detectMSS: detectMSS,
    detectStructure: detectStructure,
    previousTrend: previousTrend
  };
})(window.AT && window.AT.indicators);