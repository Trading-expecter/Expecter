(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./indicators.js'));
  else { root.AT = root.AT || {}; root.AT.analysis = factory(root.AT.indicators); }
}(typeof self !== 'undefined' ? self : this, function (I) {
  'use strict';

  const LABELS = {
    strong_buy: 'Compra fuerte',
    buy: 'Compra',
    neutral: 'Neutro',
    sell: 'Venta',
    strong_sell: 'Venta fuerte'
  };

  const SESSION_LABELS = {
    closed: 'Mercado cerrado',
    alwaysOpen: 'Mercado 24/7',
    highLiquidity: 'Alta liquidez (Londres-NY)',
    european: 'Sesión europea',
    american: 'Sesión americana',
    asian: 'Sesión asiática'
  };

  const _cache = new Map();

  function num(v) { return v != null && Number.isFinite(v); }
  function cfg() { return (typeof window !== 'undefined' && window.AT_CONFIG) || {}; }

  function weightFor(tf) {
    return ((cfg().timeframes && cfg().timeframes.weights) || {})[tf] || 1;
  }

  function biasTfs() {
    return (cfg().timeframes && cfg().timeframes.bias) || ['15m', '1h'];
  }

  function normalizeAdx(adx) {
    const ceiling = (cfg().consensus && cfg().consensus.adxNormalizationCeiling) || 40;
    if (!num(adx) || adx <= 0) return 0;
    return Math.min(adx, ceiling) / ceiling;
  }

  function cleanBars(bars) {
    if (!bars || !bars.length) return bars;
    const useClosed = (cfg().analysis && cfg().analysis.useClosedCandlesOnly) !== false;
    return (useClosed && bars.length > 1) ? bars.slice(0, -1) : bars;
  }

  function barVersion(bar) {
    return bar ? (bar.t + '|' + bar.c) : 'none';
  }

  function getTradingHours(family) {
    const th = cfg().tradingHours || {};
    const fallback = { alwaysOpen: false, open: { day: 0, hour: 22 }, close: { day: 5, hour: 22 } };
    return th[family] || th.forex || fallback;
  }

  function getMarketState(symbol, now) {
    const inst = (cfg().symbols || {})[symbol];
    if (!inst) return { open: false, family: 'unknown', alwaysOpen: false };
    const family = inst.family || 'forex';
    const th = getTradingHours(family);
    if (th.alwaysOpen) return { open: true, family: family, alwaysOpen: true };
    const currentMin = now.getUTCDay() * 1440 + now.getUTCHours() * 60 + now.getUTCMinutes();
    const openMin = th.open.day * 1440 + th.open.hour * 60;
    const closeMin = th.close.day * 1440 + th.close.hour * 60;
    return { open: currentMin >= openMin && currentMin < closeMin, family: family, alwaysOpen: false };
  }

  function getLiquidityState(now) {
    const sess = cfg().sessions || {};
    const combined = sess.combined || { startGmt: 13, endGmt: 16 };
    const london = sess.london || { startGmt: 8, endGmt: 16 };
    const ny = sess.newYork || { startGmt: 13, endGmt: 21 };
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    return {
      overlap: hour >= combined.startGmt && hour < combined.endGmt,
      london: hour >= london.startGmt && hour < london.endGmt,
      newYork: hour >= ny.startGmt && hour < ny.endGmt,
      preferred: (sess.preferredWindows || []).some(function (w) {
        return hour >= w.startGmt && hour < w.endGmt;
      })
    };
  }

  function getSessionLabel(marketState, liquidityState) {
    if (!marketState.open) return SESSION_LABELS.closed;
    if (liquidityState.overlap) return SESSION_LABELS.highLiquidity;
    if (marketState.alwaysOpen) return SESSION_LABELS.alwaysOpen;
    if (liquidityState.london) return SESSION_LABELS.european;
    if (liquidityState.newYork) return SESSION_LABELS.american;
    return SESSION_LABELS.asian;
  }

  function pickEmaPeriods(nBars, requestedFast, requestedSlow) {
    const candidates = [requestedSlow, 100, 50, 30];
    for (let i = 0; i < candidates.length; i++) {
      const slowP = candidates[i];
      if (slowP < 10) continue;
      if (nBars >= slowP + 1) {
        const ratio = requestedFast / requestedSlow;
        let fastP = Math.max(5, Math.round(slowP * ratio));
        if (fastP >= slowP) fastP = Math.max(5, slowP - 5);
        return { fast: fastP, slow: slowP, degraded: slowP !== requestedSlow };
      }
    }
    return null;
  }

  function analyzeTimeframe(bars) {
    const minBars = (cfg().analysis && cfg().analysis.minBarsPerTf) || 30;
    if (!bars || bars.length < minBars) return null;

    const closes = bars.map(function (b) { return b.c; });
    const highs = bars.map(function (b) { return b.h; });
    const lows = bars.map(function (b) { return b.l; });

    const rCfg = cfg().regime || {};
    const emaPeriods = rCfg.emaPeriods || [9, 21, 50];
    const adxPeriod = rCfg.adxPeriod || 14;
    const returnLb = rCfg.returnLookback || 15;
    const emaSepMin = rCfg.emaSeparationMinPct || 0.08;
    const returnMin = rCfg.returnMinPct || 0.08;
    const adxMin = rCfg.adxMin || 18;
    const adxStrong = rCfg.adxStrong || 25;
    const adxMax = rCfg.adxMax || 50;
    const emaStackRequired = rCfg.emaStackRequired !== false;

    const periods = pickEmaPeriods(closes.length, emaPeriods[0], emaPeriods[2]);
    if (!periods) return null;

    const emaFast = I.ema(closes, emaPeriods[0]);
    const emaMid = I.ema(closes, emaPeriods[1]);
    const emaSlow = I.ema(closes, emaPeriods[2]);
    const adxData = I.adx(highs, lows, closes, adxPeriod);
    const rsiArr = I.rsi(closes, 14);

    const i = bars.length - 1;
    const price = closes[i];
    const f = emaFast[i];
    const m = emaMid[i];
    const s = emaSlow[i];
    const adxVal = adxData.adx[i];
    const rsiVal = rsiArr[i];

    if (!num(f) || !num(m) || !num(s) || !num(adxVal) || s === 0) return null;

    let direction = 0;
    let stackAligned = false;
    if (emaStackRequired) {
      if (f > m && m > s) { direction = 1; stackAligned = true; }
      else if (f < m && m < s) { direction = -1; stackAligned = true; }
    } else {
      direction = f > s ? 1 : -1;
      stackAligned = true;
    }

    const emaSepPct = Math.abs((f - s) / s) * 100;
    const retIdx = i - returnLb;
    const returnPct = (retIdx >= 0 && closes[retIdx] > 0)
      ? ((price - closes[retIdx]) / closes[retIdx]) * 100
      : null;

    const adxOk = adxVal >= adxMin && adxVal <= adxMax;
    const emaOk = emaSepPct >= emaSepMin;
    const returnOk = num(returnPct) && Math.abs(returnPct) >= returnMin && ((returnPct > 0) === (direction === 1));
    const regimeValid = adxOk && emaOk && returnOk && stackAligned;

    return {
      direction: direction,
      adx: adxVal,
      adxStrong: adxVal >= adxStrong,
      rsi: rsiVal,
      emaSepPct: emaSepPct,
      returnPct: returnPct,
      regimeValid: regimeValid,
      stackAligned: stackAligned,
      price: price,
      fast: f,
      mid: m,
      slow: s,
      plusDI: adxData.plusDI[i],
      minusDI: adxData.minusDI[i],
      bars: bars.length,
      degraded: periods.degraded
    };
  }

  function getAnalyzedTf(rawBars, tf) {
    if (!rawBars || !rawBars.length) return null;
    const cleaned = cleanBars(rawBars);
    if (!cleaned || !cleaned.length) return null;

    const last = cleaned[cleaned.length - 1];
    const version = barVersion(last);
    const cacheKey = tf + '|' + version;
    const cached = _cache.get(cacheKey);

    if (cached) return cached;

    const result = analyzeTimeframe(cleaned);
    if (result != null) {
      _cache.set(cacheKey, result);
      if (_cache.size > 40) {
        const firstKey = _cache.keys().next().value;
        _cache.delete(firstKey);
      }
    }
    return result;
  }

  function computeSessionVwap(bars) {
    if (!bars || bars.length < 2) return null;
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const typical = (b.h + b.l + b.c) / 3;
      const vol = num(b.v) && b.v > 0 ? b.v : 1;
      cumPV += typical * vol;
      cumV += vol;
    }
    return cumV > 0 ? cumPV / cumV : null;
  }

  function computeVwapBias(entryBars, atrVal) {
    const vcfg = cfg().vwap || {};
    if (vcfg.enabled === false || !entryBars || entryBars.length < 2) {
      return { enabled: false, aligned: true, vwap: null, distanceAtr: null };
    }
    const vwap = computeSessionVwap(entryBars);
    const price = entryBars[entryBars.length - 1].c;
    if (!num(vwap) || !(atrVal > 0)) {
      return { enabled: true, aligned: true, vwap: vwap, distanceAtr: null };
    }
    const distAtr = (price - vwap) / atrVal;
    const rejectDist = vcfg.rejectDistanceAtrMult || 3.5;
    const aligned = Math.abs(distAtr) <= rejectDist;
    return {
      enabled: true,
      aligned: aligned,
      vwap: vwap,
      price: price,
      distanceAtr: distAtr,
      side: price > vwap ? 1 : -1
    };
  }

  function findLevelZones(bars, currentPrice, opts) {
    opts = opts || {};
    const lookback = opts.lookback || 3;
    const maxZones = opts.maxZones || 3;
    const atr = opts.atr || 0;
    const tolerance = atr > 0 ? atr * 0.5 : 0;

    const n = bars ? bars.length : 0;
    const empty = { supports: [], resistances: [], bestSupport: null, bestResistance: null };
    if (!n || n < lookback * 2 + 2 || !num(currentPrice)) return empty;

    const pivots = [];
    for (let i = lookback; i < n - lookback; i++) {
      const b = bars[i];
      let isHigh = true, isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (bars[i - j].h >= b.h || bars[i + j].h >= b.h) isHigh = false;
        if (bars[i - j].l <= b.l || bars[i + j].l <= b.l) isLow = false;
      }
      if (isHigh) pivots.push({ index: i, price: b.h });
      if (isLow) pivots.push({ index: i, price: b.l });
    }

    function cluster(points) {
      if (!points.length) return [];
      const sorted = points.slice().sort(function (a, b) { return a.price - b.price; });
      const groups = [];
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        let matched = null;
        for (let g = 0; g < groups.length; g++) {
          const tol = tolerance || (groups[g].avgPrice * 0.001);
          if (Math.abs(groups[g].avgPrice - p.price) <= tol) { matched = groups[g]; break; }
        }
        if (matched) {
          matched.prices.push(p.price);
          matched.indices.push(p.index);
          matched.count++;
          matched.top = Math.max(matched.top, p.price);
          matched.bottom = Math.min(matched.bottom, p.price);
          matched.avgPrice = matched.prices.reduce(function (s, v) { return s + v; }, 0) / matched.prices.length;
        } else {
          groups.push({
            avgPrice: p.price, top: p.price, bottom: p.price,
            prices: [p.price], indices: [p.index], count: 1
          });
        }
      }
      return groups.map(function (g) {
        return {
          price: g.avgPrice,
          top: g.top,
          bottom: g.bottom,
          touches: g.count,
          indices: g.indices,
          strength: Math.min(100, g.count * 30)
        };
      });
    }

    const clusters = cluster(pivots);
    const supports = clusters.filter(function (c) { return c.price < currentPrice; })
      .sort(function (a, b) { return b.price - a.price; })
      .slice(0, maxZones);
    const resistances = clusters.filter(function (c) { return c.price > currentPrice; })
      .sort(function (a, b) { return a.price - b.price; })
      .slice(0, maxZones);

    return {
      supports: supports,
      resistances: resistances,
      bestSupport: supports[0] || null,
      bestResistance: resistances[0] || null
    };
  }

  function findExtremeIdx(arr, start, end, findMin) {
    let idx = -1;
    let val = findMin ? Infinity : -Infinity;
    for (let j = start; j <= end; j++) {
      if (findMin ? arr[j] < val : arr[j] > val) { val = arr[j]; idx = j; }
    }
    return { idx: idx, val: val };
  }

  function detectPatterns(bars) {
    const result = { pinBar: null, engulfing: null };
    if (!bars || bars.length < 2) return result;

    const aCfg = cfg().anticipation || {};
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];

    const lastBody = Math.abs(last.c - last.o);
    const lastRange = last.h - last.l;
    const upperWick = last.h - Math.max(last.o, last.c);
    const lowerWick = Math.min(last.o, last.c) - last.l;

    if (lastRange > 0 && lastBody > 0) {
      const bodyRatio = lastBody / lastRange;
      const wickRatio = aCfg.pinBarWickRatio || 2.0;
      const maxBodyRatio = aCfg.pinBarBodyRatio || 0.4;

      if (lowerWick >= lastBody * wickRatio && upperWick < lastBody && bodyRatio <= maxBodyRatio) {
        result.pinBar = 'bullish';
      } else if (upperWick >= lastBody * wickRatio && lowerWick < lastBody && bodyRatio <= maxBodyRatio) {
        result.pinBar = 'bearish';
      }
    }

    if (aCfg.engulfingEnabled !== false) {
      const isBullEngulfing = (last.c > last.o) && (prev.c < prev.o) && (last.c > prev.o) && (last.o < prev.c);
      const isBearEngulfing = (last.c < last.o) && (prev.c > prev.o) && (last.c < prev.o) && (last.o > prev.c);
      if (isBullEngulfing) result.engulfing = 'bullish';
      else if (isBearEngulfing) result.engulfing = 'bearish';
    }

    return result;
  }

  function detectDivergence(bars, rsiArr) {
    const aCfg = cfg().anticipation || {};
    const lookback = aCfg.rsiDivergenceLookback || 5;
    const gap = aCfg.rsiDivergenceGap || 1;
    const minDelta = aCfg.rsiDivergenceMinDelta || 1.5;
    const n = bars.length;

    if (n < 2 * lookback + gap) return null;

    const currStart = n - lookback;
    const prevEnd = currStart - gap - 1;
    const prevStart = prevEnd - lookback + 1;
    if (prevStart < 0) return null;

    const lows = bars.map(b => b.l);
    const highs = bars.map(b => b.h);

    const currLow = findExtremeIdx(lows, currStart, n - 1, true);
    const prevLow = findExtremeIdx(lows, prevStart, prevEnd, true);

    if (currLow.idx !== -1 && prevLow.idx !== -1 &&
        currLow.val < prevLow.val &&
        num(rsiArr[currLow.idx]) && num(rsiArr[prevLow.idx]) &&
        (rsiArr[currLow.idx] - rsiArr[prevLow.idx]) >= minDelta) {
      return 'bullish';
    }

    const currHigh = findExtremeIdx(highs, currStart, n - 1, false);
    const prevHigh = findExtremeIdx(highs, prevStart, prevEnd, false);

    if (currHigh.idx !== -1 && prevHigh.idx !== -1 &&
        currHigh.val > prevHigh.val &&
        num(rsiArr[currHigh.idx]) && num(rsiArr[prevHigh.idx]) &&
        (rsiArr[prevHigh.idx] - rsiArr[currHigh.idx]) >= minDelta) {
      return 'bearish';
    }

    return null;
  }

  function detectSweep(bars, levels) {
    const aCfg = cfg().anticipation || {};
    if (aCfg.sweepEnabled === false) return null;

    const lookback = aCfg.sweepLookback || 6;
    const n = bars ? bars.length : 0;
    if (!n || n < 2) return null;

    const start = Math.max(0, n - lookback);

    for (let i = n - 1; i >= start; i--) {
      const b = bars[i];
      if (levels.bestSupport && b.l < levels.bestSupport.bottom && b.c > levels.bestSupport.bottom) {
        return 'bullish';
      }
      if (levels.bestResistance && b.h > levels.bestResistance.top && b.c < levels.bestResistance.top) {
        return 'bearish';
      }
    }
    return null;
  }

  function isExhausted(rsiVal, adxVal, adxPrev) {
    const cfgExh = cfg().exhaustion || {};
    const rsiOb = cfgExh.rsiOverbought || 85;
    const rsiOs = cfgExh.rsiOversold || 15;
    
    if (num(rsiVal) && (rsiVal > rsiOb || rsiVal < rsiOs)) return true;
    if (num(adxVal) && num(adxPrev) && adxVal > 40 && adxPrev > adxVal * 1.15) return true;
    return false;
  }

  function detectBreakoutSetup(bars, atr, currentPrice) {
    const cfgBr = cfg().breakout || {};
    if (cfgBr.enabled === false || !bars || bars.length < 10) return null;

    const last = bars[bars.length - 1];
    const body = Math.abs(last.c - last.o);
    const range = last.h - last.l;
    
    const minBody = atr * (cfgBr.minBodyAtrMult || 1.2);
    const minRange = atr * (cfgBr.minRangeAtrMult || 1.5);

    let type = null;
    let score = 0;
    const reasons = [];

    if (body >= minBody && range >= minRange) {
      if (last.c < last.o) {
        type = 'sell';
        score = Math.min(100, 60 + (body / atr) * 5);
        reasons.push('Vela de impulso bajista');
      } else if (last.c > last.o) {
        type = 'buy';
        score = Math.min(100, 60 + (body / atr) * 5);
        reasons.push('Vela de impulso alcista');
      }
    }

    if (type && score >= (cfgBr.minScore || 70)) {
      return { type, score, reasons };
    }
    return null;
  }

  function detectStructureShift(bars, atr, currentPrice) {
    if (bars.length < 15) return null;

    const lookback = 10;
    let localMin = Infinity, localMax = -Infinity;
    let minIdx = -1, maxIdx = -1;

    for (let i = bars.length - lookback; i < bars.length - 1; i++) {
      if (bars[i].l < localMin) { localMin = bars[i].l; minIdx = i; }
      if (bars[i].h > localMax) { localMax = bars[i].h; maxIdx = i; }
    }

    const last = bars[bars.length - 1];

    if (maxIdx > minIdx && last.c > localMax && currentPrice >= last.c) {
      return { type: 'buy', score: 75, reasons: ['Ruptura de estructura (CHoCH) alcista'] };
    }
    
    if (minIdx > maxIdx && last.c < localMin && currentPrice <= last.c) {
      return { type: 'sell', score: 75, reasons: ['Ruptura de estructura (CHoCH) bajista'] };
    }

    return null;
  }

  function detectReversalSetup(bars, levels, atr, currentPrice, rsiVal) {
    const cfgRev = cfg().reversal || {};
    if (cfgRev.enabled === false) return null;

    const patterns = detectPatterns(bars);
    const closes = bars.map(b => b.c);
    const rsiArr = I.rsi(closes, 14);
    const div = detectDivergence(bars, rsiArr);
    const sweep = detectSweep(bars, levels);

    let buyScore = 0, sellScore = 0;
    let buyReasons = [], sellReasons = [];

    if (rsiVal <= cfgRev.rsiBuyZone) { buyScore += 30; buyReasons.push('RSI sobreventa'); }
    if (rsiVal >= cfgRev.rsiSellZone) { sellScore += 30; sellReasons.push('RSI sobrecompra'); }

    if (div === 'bullish') { buyScore += 30; buyReasons.push('Divergencia alcista'); }
    if (div === 'bearish') { sellScore += 30; sellReasons.push('Divergencia bajista'); }

    if (sweep === 'bullish') { buyScore += 20; buyReasons.push('Sweep de mínimos'); }
    if (sweep === 'bearish') { sellScore += 20; sellReasons.push('Sweep de máximos'); }

    if (patterns.pinBar === 'bullish' || patterns.engulfing === 'bullish') { buyScore += 20; buyReasons.push('Rechazo alcista'); }
    if (patterns.pinBar === 'bearish' || patterns.engulfing === 'bearish') { sellScore += 20; sellReasons.push('Rechazo bajista'); }

    if (cfgRev.requireDivergence && !div) { buyScore = 0; sellScore = 0; }
    if (cfgRev.requireSweep && !sweep) { buyScore = 0; sellScore = 0; }
    if (cfgRev.requireCandleRejection && !(patterns.pinBar || patterns.engulfing)) { buyScore = 0; sellScore = 0; }

    if (buyScore >= cfgRev.minScore && buyScore > sellScore) return { type: 'buy', score: buyScore, reasons: buyReasons };
    if (sellScore >= cfgRev.minScore && sellScore > buyScore) return { type: 'sell', score: sellScore, reasons: sellReasons };
    return null;
  }

  function detectContinuationSetup(bars, direction, atr, currentPrice, vwapBias) {
    const cfgCont = cfg().continuation || {};
    if (cfgCont.enabled === false || (direction !== 1 && direction !== -1)) return null;

    const closes = bars.map(b => b.c);
    const ema21 = I.ema(closes, 21);
    const ema50 = I.ema(closes, 50);
    const currentEma21 = ema21[ema21.length - 1];
    const currentEma50 = ema50[ema50.length - 1];

    const nearEma21 = num(currentEma21) && Math.abs(currentPrice - currentEma21) <= (atr * cfgCont.emaProximityAtr);
    const nearEma50 = num(currentEma50) && Math.abs(currentPrice - currentEma50) <= (atr * cfgCont.emaProximityAtr);
    const nearVwap = vwapBias && vwapBias.vwap && Math.abs(currentPrice - vwapBias.vwap) <= (atr * cfgCont.vwapProximityAtr);

    if (!nearEma21 && !nearEma50 && !nearVwap) return null;

    const patterns = detectPatterns(bars);
    let score = 0;
    const reasons = [];

    const isBullRej = patterns.pinBar === 'bullish' || patterns.engulfing === 'bullish';
    const isBearRej = patterns.pinBar === 'bearish' || patterns.engulfing === 'bearish';

    if (direction === 1 && isBullRej) { score += 50; reasons.push('Rechazo alcista'); }
    if (direction === -1 && isBearRej) { score += 50; reasons.push('Rechazo bajista'); }

    if (nearEma21 || nearEma50) { score += 20; reasons.push('Cerca de EMA'); }
    if (nearVwap) { score += 30; reasons.push('Cerca de VWAP'); }

    if (cfgCont.requireCandleRejection && score < 50) return null;

    if (score >= cfgCont.minScore) return { type: direction, score, reasons };
    return null;
  }

  function suggestRisk(entry, support, resistance, atr, direction) {
    const riskCfg = cfg().risk || {};
    const stopMult = riskCfg.atrStopMult || 1.5;
    const targetMult = riskCfg.atrTargetMult || 2.0;
    const minRR = riskCfg.minRR || 1.3;
    if (!num(entry) || !num(atr) || atr <= 0) return null;

    let stop, target;
    if (direction === 1) {
      const atrStop = entry - stopMult * atr;
      stop = num(support) ? Math.min(support, atrStop) : atrStop;
      const atrTarget = entry + targetMult * atr;
      target = num(resistance) ? Math.min(resistance, atrTarget) : atrTarget;
      if (target <= entry) return null;
    } else if (direction === -1) {
      const atrStop = entry + stopMult * atr;
      stop = num(resistance) ? Math.max(resistance, atrStop) : atrStop;
      const atrTarget = entry - targetMult * atr;
      target = num(support) ? Math.max(support, atrTarget) : atrTarget;
      if (target >= entry) return null;
    } else {
      return null;
    }

    const risk = direction === 1 ? entry - stop : stop - entry;
    const reward = direction === 1 ? target - entry : entry - target;
    if (risk <= 0 || reward <= 0) return null;

    const rr = reward / risk;
    return { stop: stop, target: target, rr: rr, valid: rr >= minRR };
  }

  function computeConsensus(valid, thresholds, weightedMajority) {
    let buyWeight = 0;
    let sellWeight = 0;
    for (let i = 0; i < valid.length; i++) {
      if (valid[i].data.direction === 1) buyWeight += valid[i].data.evidence;
      else if (valid[i].data.direction === -1) sellWeight += valid[i].data.evidence;
    }
    const totalWeight = buyWeight + sellWeight;
    const buyShare = totalWeight > 0 ? buyWeight / totalWeight : 0.5;

    let overallDirection = 0;
    if (buyShare >= weightedMajority) overallDirection = 1;
    else if (buyShare <= 1 - weightedMajority) overallDirection = -1;

    let sumAllEvidence = 0;
    let sumAgreeEvidence = 0;
    let sumAgreeAdx = 0;
    let sumOpposedAdx = 0;
    let agreeCount = 0;
    let opposedCount = 0;

    for (let i = 0; i < valid.length; i++) {
      const v = valid[i];
      const agree = overallDirection !== 0 && v.data.direction === overallDirection;
      v.agree = agree;
      sumAllEvidence += v.data.evidence;
      if (agree) {
        sumAgreeEvidence += v.data.evidence;
        sumAgreeAdx += v.data.adx;
        agreeCount++;
      } else {
        sumOpposedAdx += v.data.adx;
        opposedCount++;
      }
    }

    const consensusScore = sumAllEvidence > 0 ? (sumAgreeEvidence / sumAllEvidence) * 100 : 0;
    const avgAdxAligned = agreeCount > 0 ? sumAgreeAdx / agreeCount : 0;
    const avgAdxOpposed = opposedCount > 0 ? sumOpposedAdx / opposedCount : 0;
    const magnitude = avgAdxAligned > 0 ? normalizeAdx(avgAdxAligned) : 0;
    const confidence = overallDirection !== 0 ? magnitude * (consensusScore / 100) * 100 : 0;

    let consensusLabel;
    if (overallDirection === 0) consensusLabel = 'neutral';
    else if (consensusScore >= thresholds.strong) consensusLabel = overallDirection === 1 ? 'strong_buy' : 'strong_sell';
    else if (consensusScore >= thresholds.moderate) consensusLabel = overallDirection === 1 ? 'buy' : 'sell';
    else consensusLabel = 'neutral';

    return {
      overallDirection: overallDirection,
      buyShare: buyShare,
      consensusScore: consensusScore,
      consensusLabel: consensusLabel,
      avgAdxAligned: avgAdxAligned,
      avgAdxOpposed: avgAdxOpposed,
      confidence: confidence
    };
  }

  function computeVoteBreakdown(valid) {
    let buy = 0, sell = 0, neutral = 0;
    const byTf = {};
    for (let i = 0; i < valid.length; i++) {
      const v = valid[i];
      const d = v.data.direction;
      byTf[v.tf] = d;
      if (d === 1) buy++;
      else if (d === -1) sell++;
      else neutral++;
    }
    return { buy, sell, neutral, total: valid.length, byTf };
  }

  function computeMultiTfSignal(valid, marketOpen) {
    if (!marketOpen) {
      return { action: 'wait', strength: 'closed', alignment: 0, votes: { buy: 0, sell: 0, neutral: 0, total: 0, byTf: {} }, summary: 'Mercado cerrado.' };
    }
    if (!valid.length) {
      return { action: 'wait', strength: 'none', alignment: 0, votes: { buy: 0, sell: 0, neutral: 0, total: 0, byTf: {} }, summary: 'Sin temporalidades analizadas.' };
    }

    const votes = computeVoteBreakdown(valid);
    const decided = votes.buy + votes.sell;
    const winning = Math.max(votes.buy, votes.sell);
    const alignment = decided > 0 ? (winning / decided) * 100 : 0;

    let action = 'wait';
    let strength = 'weak';

    if (votes.buy > votes.sell && alignment >= 55) {
      action = 'buy';
      strength = (alignment >= 75 && votes.buy >= 3) ? 'strong' : (alignment >= 60 && votes.buy >= 2) ? 'moderate' : 'weak';
    } else if (votes.sell > votes.buy && alignment >= 55) {
      action = 'sell';
      strength = (alignment >= 75 && votes.sell >= 3) ? 'strong' : (alignment >= 60 && votes.sell >= 2) ? 'moderate' : 'weak';
    }

    const summary = votes.buy + '/' + votes.total + ' alcistas · ' + votes.sell + '/' + votes.total + ' bajistas · ' + votes.neutral + ' neutras (alineación ' + alignment.toFixed(0) + '%)';
    return { action, strength, alignment, votes, summary };
  }

  function computeVerdict(ctx) {
    if (!ctx.marketOpen) {
      return { state: 'wait', label: 'ESPERAR', reason: 'Mercado cerrado.' };
    }

    const digits = (cfg().symbols && cfg().symbols[ctx.symbol] && cfg().symbols[ctx.symbol].digits) || 2;
    const fmt = function (p) { return num(p) ? p.toFixed(digits) : '—'; };

    if (ctx.structureShift) {
      const dir = ctx.structureShift.type === 'buy' ? 1 : -1;
      if (ctx.overallDirection !== 0 && dir !== ctx.overallDirection) {
        return { state: 'wait', label: 'ESPERAR', reason: 'Cambio de estructura contra sesgo principal. Esperando alineación.' };
      }
      const risk = suggestRisk(ctx.currentPrice, ctx.levels.bestSupport ? ctx.levels.bestSupport.price : null, ctx.levels.bestResistance ? ctx.levels.bestResistance.price : null, ctx.atr, dir);
      if (!risk || !risk.valid) {
        return { state: 'wait', label: 'ESPERAR', reason: 'Estructura rota pero R:R insuficiente.' };
      }
      const isBuy = dir === 1;
      return {
        state: isBuy ? 'buy' : 'sell',
        label: isBuy ? '¡COMPRAR AHORA! (Cambio de Tendencia)' : '¡VENDER AHORA! (Cambio de Tendencia)',
        reason: 'Estructura rota: ' + ctx.structureShift.reasons.join(', ') + '. R:R ' + risk.rr.toFixed(2) + ':1 · Stop ' + fmt(risk.stop) + ' · Target ' + fmt(risk.target),
        risk: risk
      };
    }

    if (ctx.breakout) {
      const dir = ctx.breakout.type === 'buy' ? 1 : -1;
      if (ctx.overallDirection !== 0 && dir !== ctx.overallDirection) {
        return { state: 'wait', label: 'ESPERAR', reason: 'Breakout contra el sesgo multi-TF. Se requiere alineación para operar.' };
      }
      const risk = suggestRisk(ctx.currentPrice, ctx.levels.bestSupport ? ctx.levels.bestSupport.price : null, ctx.levels.bestResistance ? ctx.levels.bestResistance.price : null, ctx.atr, dir);
      if (!risk || !risk.valid) {
        return { state: 'wait', label: 'ESPERAR', reason: 'Breakout detectado pero R:R insuficiente.' };
      }
      const isBuy = dir === 1;
      return {
        state: isBuy ? 'buy' : 'sell',
        label: isBuy ? '¡COMPRAR AHORA! (Breakout)' : '¡VENDER AHORA! (Breakout)',
        reason: 'Movimiento de fuerza: ' + ctx.breakout.reasons.join(', ') + '. R:R ' + risk.rr.toFixed(2) + ':1 · Stop ' + fmt(risk.stop) + ' · Target ' + fmt(risk.target),
        risk: risk
      };
    }

    if (ctx.reversal) {
      const dir = ctx.reversal.type === 'buy' ? 1 : -1;
      if (ctx.overallDirection !== 0 && dir !== ctx.overallDirection) {
        // Permitimos reversión contra tendencia solo si es muy fuerte
        if (ctx.reversal.score < 85) {
          return { state: 'wait', label: 'ESPERAR', reason: 'Reversión contra tendencia pero no es lo suficientemente fuerte.' };
        }
      }
      const risk = suggestRisk(ctx.currentPrice, ctx.levels.bestSupport ? ctx.levels.bestSupport.price : null, ctx.levels.bestResistance ? ctx.levels.bestResistance.price : null, ctx.atr, dir);
      if (!risk || !risk.valid) {
        return { state: 'wait', label: 'ESPERAR', reason: 'Setup de reversión con R:R insuficiente.' };
      }
      const isBuy = dir === 1;
      return {
        state: isBuy ? 'buy' : 'sell',
        label: isBuy ? '¡COMPRAR AHORA! (Reversión)' : '¡VENDER AHORA! (Reversión)',
        reason: 'Setup de reversión: ' + ctx.reversal.reasons.join(', ') + '. R:R ' + risk.rr.toFixed(2) + ':1 · Stop ' + fmt(risk.stop) + ' · Target ' + fmt(risk.target),
        risk: risk
      };
    }

    if (ctx.isExhausted) {
      return {
        state: 'wait',
        label: 'ESPERAR (Agotamiento)',
        reason: 'Tendencia agotada (RSI extremo o ADX cayendo). No perseguir el precio. Esperando divergencia/sweep o cambio de estructura.'
      };
    }

    if (ctx.continuation) {
      const dir = ctx.continuation.type === 'buy' ? 1 : -1;
      const risk = suggestRisk(ctx.currentPrice, ctx.levels.bestSupport ? ctx.levels.bestSupport.price : null, ctx.levels.bestResistance ? ctx.levels.bestResistance.price : null, ctx.atr, dir);
      if (!risk || !risk.valid) {
        return { state: 'wait', label: 'ESPERAR', reason: 'Retroceso detectado pero R:R insuficiente.' };
      }
      const isBuy = dir === 1;
      return {
        state: isBuy ? 'buy' : 'sell',
        label: isBuy ? 'COMPRAR (Retroceso)' : 'VENDER (Retroceso)',
        reason: 'Retroceso a zona de valor: ' + ctx.continuation.reasons.join(', ') + '. R:R ' + risk.rr.toFixed(2) + ':1 · Stop ' + fmt(risk.stop) + ' · Target ' + fmt(risk.target),
        risk: risk
      };
    }

    return {
      state: 'wait',
      label: 'ESPERAR',
      reason: 'Sin setup claro. ' + (ctx.overallDirection === 1 ? 'Sesgo alcista, buscando retroceso.' : ctx.overallDirection === -1 ? 'Sesgo bajista, buscando retroceso.' : 'Consenso neutral.')
    };
  }

  function emptyResult(reason, sessionLabel, marketOpen, symbolFamily) {
    return {
      consensusScore: 0, consensusLabel: 'neutral', consensusText: LABELS.neutral, confidence: 0,
      overallDirection: 0, perTf: {}, macroTrend: '—', macroMomentum: '—', macroVolatility: '—',
      avgAdxAligned: 0, avgAdxOpposed: 0, alerts: [],
      verdictState: 'wait', verdictLabel: 'ESPERAR', verdictReason: reason || 'Datos insuficientes.',
      verdictRisk: null, anticipationRisk: null, vwapBias: null,
      marketOpen: !!marketOpen, highLiquidity: false,
      sessionLabel: sessionLabel || SESSION_LABELS.closed, symbolFamily: symbolFamily || 'unknown',
      entryTf: null, levels: { supports: [], resistances: [], bestSupport: null, bestResistance: null },
      proximitySignal: null, anticipation: null,
      multiTfSignal: { action: 'wait', strength: 'none', alignment: 0, votes: { buy: 0, sell: 0, neutral: 0, total: 0, byTf: {} }, summary: reason || 'Datos insuficientes.' },
      conclusion: reason || 'Datos insuficientes.', computedAt: Date.now()
    };
  }

  function analyze(barsByTf, opts) {
    try {
      return _analyze(barsByTf, opts);
    } catch (e) {
      console.error('[analysis] analyze() excepción:', e);
      return emptyResult('Error interno de análisis: ' + (e && e.message ? e.message : 'desconocido'));
    }
  }

  function _analyze(barsByTf, opts) {
    opts = opts || {};
    const c = cfg();
    const consensusCfg = c.consensus || {};
    const riskCfg = c.risk || {};
    const regimeCfg = c.regime || {};
    const exCfg = c.exhaustion || {};
    const thresholds = consensusCfg.thresholds || { strong: 60, moderate: 40 };
    const minValidTfs = consensusCfg.minimumValidTfs || 2;
    const weightedMajority = consensusCfg.weightedMajority || 0.55;

    const entryTf = opts.currentTf || (c.timeframes && c.timeframes.entry) || '5m';
    const symbol = opts.symbol || 'XAUUSD';

    const now = new Date();
    const marketState = getMarketState(symbol, now);
    const liquidityState = getLiquidityState(now);
    const sessionLabel = getSessionLabel(marketState, liquidityState);

    const perTf = {};
    const valid = [];
    const keys = Object.keys(barsByTf || {});

    for (let k = 0; k < keys.length; k++) {
      const tf = keys[k];
      try {
        const r = getAnalyzedTf(barsByTf[tf], tf);
        if (!r) continue;
        r.adxNorm = normalizeAdx(r.adx);
        r.weight = weightFor(tf);
        r.evidence = r.weight * r.adxNorm;
        perTf[tf] = r;
        if (r.direction !== 0) valid.push({ tf: tf, data: r });
      } catch (e) {
        console.error('[analysis] ' + tf + ' excepción:', e);
      }
    }

    if (valid.length === 0) {
      return emptyResult('Datos insuficientes: no se ha podido analizar ninguna temporalidad con dirección clara.', sessionLabel, marketState.open, marketState.family);
    }

    const consensus = computeConsensus(valid, thresholds, weightedMajority);
    const overallDirection = consensus.overallDirection;
    const consensusScore = consensus.consensusScore;

    const multiTfSignal = computeMultiTfSignal(valid, marketState.open);

    const macroTrend = consensus.avgAdxAligned >= 28 ? 'Muy fuerte' : consensus.avgAdxAligned >= 23 ? 'Fuerte' : consensus.avgAdxAligned >= 18 ? 'Moderada' : 'Débil';

    const entryBarsRaw = barsByTf[entryTf] || null;
    const entryBars = entryBarsRaw ? cleanBars(entryBarsRaw) : null;
    let macroMomentum = '—';
    let macroVolatility = '—';
    let alerts = [];
    let atrVal = 0;

    if (entryBars && entryBars.length >= 20) {
      const hc = entryBars.map(function (b) { return b.c; });
      const hh = entryBars.map(function (b) { return b.h; });
      const hl = entryBars.map(function (b) { return b.l; });

      const rsiArr = I.rsi(hc, 14);
      const lastRsi = rsiArr[rsiArr.length - 1];
      if (num(lastRsi)) macroMomentum = lastRsi >= 60 ? 'Alcista' : lastRsi <= 40 ? 'Bajista' : 'Neutro';

      const atrArr = I.atr(hh, hl, hc, riskCfg.atrPeriod || 14);
      const lastAtr = atrArr[atrArr.length - 1];
      const cleanAtr = atrArr.filter(num);
      const avgAtrArr = I.sma(cleanAtr, 20);
      const avgAtrVal = avgAtrArr[avgAtrArr.length - 1];

      if (num(lastAtr) && num(avgAtrVal) && avgAtrVal > 0) {
        atrVal = lastAtr;
        const ratio = lastAtr / avgAtrVal;
        macroVolatility = ratio >= 1.3 ? 'Alta' : ratio <= 0.75 ? 'Baja' : 'Normal';
      }
      alerts = detectExhaustion(entryBars, overallDirection, exCfg);
    }

    const vwapBias = computeVwapBias(entryBars, atrVal);

    if (marketState.open && liquidityState.preferred && !liquidityState.overlap && !marketState.alwaysOpen) {
      alerts.push({ type: 'info', text: 'Ventana de liquidez preferida activa.' });
    }

    const entryData = perTf[entryTf];
    const currentPrice = entryData ? entryData.price : (valid[0] ? valid[0].data.price : null);
    const levels = findLevelZones(entryBars, currentPrice, { lookback: 3, maxZones: 3, atr: atrVal });

    const rsiEntryArr = entryBars ? I.rsi(entryBars.map(b => b.c), 14) : [];
    const adxEntryArr = entryBars ? I.adx(entryBars.map(b => b.h), entryBars.map(b => b.l), entryBars.map(b => b.c), 14).adx : [];
    
    const rsiVal = rsiEntryArr.length ? rsiEntryArr[rsiEntryArr.length - 1] : null;
    const adxVal = adxEntryArr.length ? adxEntryArr[adxEntryArr.length - 1] : null;
    const adxPrev = adxEntryArr.length > 5 ? adxEntryArr[adxEntryArr.length - 5] : null;

    const exhausted = isExhausted(rsiVal, adxVal, adxPrev);

    let structureShiftSetup = null;
    let breakoutSetup = null;
    let reversalSetup = null;
    let continuationSetup = null;

    if (entryBars && entryBars.length > 20) {
      structureShiftSetup = detectStructureShift(entryBars, atrVal, currentPrice);
      
      if (!structureShiftSetup) {
        breakoutSetup = detectBreakoutSetup(entryBars, atrVal, currentPrice);
      }
      
      if (!structureShiftSetup && !breakoutSetup) {
        reversalSetup = detectReversalSetup(entryBars, levels, atrVal, currentPrice, rsiVal);
        if (!reversalSetup && !exhausted) {
          continuationSetup = detectContinuationSetup(entryBars, overallDirection, atrVal, currentPrice, vwapBias);
        }
      }
    }

    const proxSignal = proximitySignal(currentPrice, atrVal, levels, overallDirection || 0, entryData ? entryData.rsi : null);

    const anticipation = entryBars ? detectAnticipation(entryBars, levels, atrVal, currentPrice) : null;
    let anticipationRisk = null;
    if (anticipation && currentPrice != null) {
      const aDir = anticipation.type === 'buy' ? 1 : -1;
      anticipationRisk = suggestRisk(currentPrice, levels.bestSupport ? levels.bestSupport.price : null, levels.bestResistance ? levels.bestResistance.price : null, atrVal, aDir);
    }

    const dangerCount = alerts.filter(function (a) { return a.type === 'danger'; }).length;

    const verdict = computeVerdict({
      marketOpen: marketState.open,
      overallDirection: overallDirection,
      currentPrice: currentPrice,
      atr: atrVal,
      levels: levels,
      isExhausted: exhausted,
      structureShift: structureShiftSetup,
      breakout: breakoutSetup,
      reversal: reversalSetup,
      continuation: continuationSetup,
      symbol: symbol
    });

    const conclusionParts = [];
    if (!marketState.open) {
      conclusionParts.push('Mercado cerrado para ' + symbol + ' (' + marketState.family + ').');
    } else {
      conclusionParts.push('Análisis multi-TF: ' + multiTfSignal.summary + '.');
      if (verdict.state === 'buy' || verdict.state === 'sell') {
        conclusionParts.push('Setup detectado: ' + verdict.label + '. ' + verdict.reason);
      } else {
        conclusionParts.push(verdict.reason);
      }
    }

    return {
      consensusScore: consensusScore,
      consensusLabel: consensus.consensusLabel,
      consensusText: LABELS[consensus.consensusLabel],
      confidence: consensus.confidence,
      overallDirection: overallDirection,
      perTf: perTf,
      macroTrend: macroTrend,
      macroMomentum: macroMomentum,
      macroVolatility: macroVolatility,
      avgAdxAligned: consensus.avgAdxAligned,
      avgAdxOpposed: consensus.avgAdxOpposed,
      alerts: alerts,
      verdictState: verdict.state,
      verdictLabel: verdict.label,
      verdictReason: verdict.reason,
      verdictRisk: verdict.risk,
      anticipationRisk: anticipationRisk,
      vwapBias: vwapBias,
      levels: levels,
      proximitySignal: proxSignal,
      anticipation: anticipation,
      multiTfSignal: multiTfSignal,
      marketOpen: marketState.open,
      highLiquidity: liquidityState.overlap,
      preferredSession: liquidityState.preferred,
      sessionLabel: sessionLabel,
      symbolFamily: marketState.family,
      entryTf: entryTf,
      conclusion: conclusionParts.join(' '),
      computedAt: Date.now()
    };
  }

  function proximitySignal(currentPrice, atrVal, levels, direction, rsiVal) {
    if (!num(currentPrice) || !(atrVal > 0)) return null;
    const nearDist = atrVal * 0.6;

    if (direction === 1 && levels.bestSupport) {
      const dist = currentPrice - levels.bestSupport.price;
      if (dist >= 0 && dist <= nearDist) {
        const strong = levels.bestSupport.touches >= 2;
        const rsiOk = !num(rsiVal) || rsiVal < 55;
        if (strong && rsiOk) return { type: 'strong_buy', label: 'SOPORTE FUERTE — COMPRAR', level: levels.bestSupport.price, distance: dist, touches: levels.bestSupport.touches };
        return { type: 'buy', label: 'Cerca de soporte', level: levels.bestSupport.price, distance: dist, touches: levels.bestSupport.touches };
      }
    }

    if (direction === -1 && levels.bestResistance) {
      const dist = levels.bestResistance.price - currentPrice;
      if (dist >= 0 && dist <= nearDist) {
        const strong = levels.bestResistance.touches >= 2;
        const rsiOk = !num(rsiVal) || rsiVal > 45;
        if (strong && rsiOk) return { type: 'strong_sell', label: 'RESISTENCIA FUERTE — VENDER', level: levels.bestResistance.price, distance: dist, touches: levels.bestResistance.touches };
        return { type: 'sell', label: 'Cerca de resistencia', level: levels.bestResistance.price, distance: dist, touches: levels.bestResistance.touches };
      }
    }
    return null;
  }

  function detectExhaustion(bars, direction, exCfg) {
    const alerts = [];
    if (!bars || bars.length < 40) return alerts;

    const closes = bars.map(function (b) { return b.c; });
    const highs = bars.map(function (b) { return b.h; });
    const lows = bars.map(function (b) { return b.l; });

    const i = bars.length - 1;
    const rsiArr = I.rsi(closes, exCfg.rsiPeriod || 14);
    const adxArr = I.adx(highs, lows, closes, 14).adx;

    const lastRsi = rsiArr[i];
    const prevRsi = rsiArr[i - 1];
    const ob = exCfg.rsiOverbought || 85;
    const os = exCfg.rsiOversold || 15;
    if (num(lastRsi) && num(prevRsi)) {
      if (lastRsi > ob && prevRsi <= ob) alerts.push({ type: 'info', text: 'RSI cruza sobrecompra (' + lastRsi.toFixed(1) + ').' });
      else if (lastRsi < os && prevRsi >= os) alerts.push({ type: 'info', text: 'RSI cruza sobreventa (' + lastRsi.toFixed(1) + ').' });
    }

    const lookback = exCfg.lookbackCandles || 5;
    if (i >= lookback && num(adxArr[i]) && num(adxArr[i - lookback]) && adxArr[i - lookback] > 0) {
      const dropPct = ((adxArr[i - lookback] - adxArr[i]) / adxArr[i - lookback]) * 100;
      if (dropPct > (exCfg.adxDropPct || 25)) alerts.push({ type: 'info', text: 'ADX cae ' + dropPct.toFixed(0) + '% en ' + lookback + ' velas.' });
    }

    const divLb = exCfg.divergenceLookback || 8;
    const gap = exCfg.divergenceGap != null ? exCfg.divergenceGap : 1;
    if (i >= 2 * divLb + gap - 1) {
      const currStart = i - divLb + 1;
      const prevEnd = currStart - gap - 1;
      const prevStart = prevEnd - divLb + 1;

      const currLow = findExtremeIdx(lows, currStart, i, true);
      const prevLow = findExtremeIdx(lows, prevStart, prevEnd, true);
      if (currLow.idx !== -1 && prevLow.idx !== -1 && currLow.val < prevLow.val && num(rsiArr[currLow.idx]) && num(rsiArr[prevLow.idx]) && rsiArr[currLow.idx] > rsiArr[prevLow.idx]) {
        alerts.push({ type: 'danger', text: 'Divergencia alcista RSI.' });
      }

      const currHigh = findExtremeIdx(highs, currStart, i, false);
      const prevHigh = findExtremeIdx(highs, prevStart, prevEnd, false);
      if (currHigh.idx !== -1 && prevHigh.idx !== -1 && currHigh.val > prevHigh.val && num(rsiArr[currHigh.idx]) && num(rsiArr[prevHigh.idx]) && rsiArr[currHigh.idx] < rsiArr[prevHigh.idx]) {
        alerts.push({ type: 'danger', text: 'Divergencia bajista RSI.' });
      }
    }
    return alerts;
  }

  function detectAnticipation(bars, levels, atrVal, currentPrice) {
    const aCfg = cfg().anticipation || {};
    if (aCfg.enabled === false || !bars || bars.length < 30) return null;

    const closes = bars.map(function (b) { return b.c; });
    const rsiArr = I.rsi(closes, 14);
    const patterns = detectPatterns(bars);
    const rsiDiv = detectDivergence(bars, rsiArr);
    const sweep = detectSweep(bars, levels);

    let buyScore = 0, sellScore = 0;
    const buyFactors = [], sellFactors = [];

    if (rsiDiv === 'bullish') { buyScore += (aCfg.scoreRsiDivergence || 25); buyFactors.push('Divergencia RSI alcista'); }
    else if (rsiDiv === 'bearish') { sellScore += (aCfg.scoreRsiDivergence || 25); sellFactors.push('Divergencia RSI bajista'); }

    if (patterns.pinBar === 'bullish') { buyScore += (aCfg.scorePinBar || 20); buyFactors.push('Pin Bar alcista'); }
    else if (patterns.pinBar === 'bearish') { sellScore += (aCfg.scorePinBar || 20); sellFactors.push('Pin Bar bajista'); }

    if (patterns.engulfing === 'bullish') { buyScore += (aCfg.scoreEngulfing || 15); buyFactors.push('Envolvente alcista'); }
    else if (patterns.engulfing === 'bearish') { sellScore += (aCfg.scoreEngulfing || 15); sellFactors.push('Envolvente bajista'); }

    if (sweep === 'bullish') { buyScore += (aCfg.scoreSweep || 20); buyFactors.push('Barrido de mínimos'); }
    else if (sweep === 'bearish') { sellScore += (aCfg.scoreSweep || 20); sellFactors.push('Barrido de máximos'); }

    const prox = aCfg.minLevelProximityAtr || 0.6;
    const nearSupport = levels.bestSupport && currentPrice && (currentPrice - levels.bestSupport.price) <= (atrVal * prox);
    const nearResistance = levels.bestResistance && currentPrice && (levels.bestResistance.price - currentPrice) <= (atrVal * prox);

    if (!nearSupport) buyScore = Math.max(0, buyScore - 20);
    if (!nearResistance) sellScore = Math.max(0, sellScore - 20);

    const minConf = aCfg.minConfidence || 45;
    let type = null, score = 0, factors = [];

    if (buyScore > sellScore && buyScore >= minConf) { type = 'buy'; score = Math.min(100, buyScore); factors = buyFactors; }
    else if (sellScore > buyScore && sellScore >= minConf) { type = 'sell'; score = Math.min(100, sellScore); factors = sellFactors; }

    if (!type) return null;
    return { type, score, confidence: score, factors, strength: score >= (aCfg.strongConfidence || 70) ? 'strong' : 'moderate' };
  }

  function invalidateCache() { _cache.clear(); }

  return {
    analyze, invalidateCache, LABELS, SESSION_LABELS,
    getMarketState, getLiquidityState, getSessionLabel
  };
}));