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
    return (cfg().timeframes && cfg().timeframes.bias) || ['4h', '1d'];
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
      newYork: hour >= ny.startGmt && hour < ny.endGmt
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
        let fastP = Math.max(10, Math.round(slowP * ratio));
        if (fastP >= slowP) fastP = Math.max(10, slowP - 5);
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
    const emaFastP = rCfg.emaFast || 50;
    const emaSlowP = rCfg.emaSlow || 200;
    const adxPeriod = rCfg.adxPeriod || 14;
    const returnLb = rCfg.returnLookback || 30;
    const emaSepMin = rCfg.emaSeparationMinPct || 0.5;
    const returnMin = rCfg.returnMinPct || 0.2;
    const adxMin = rCfg.adxMin || 22;
    const adxStrong = rCfg.adxStrong || 28;

    const periods = pickEmaPeriods(closes.length, emaFastP, emaSlowP);
    if (!periods) return null;

    const fast = I.ema(closes, periods.fast);
    const slow = I.ema(closes, periods.slow);
    const adxData = I.adx(highs, lows, closes, adxPeriod);
    const rsiArr = I.rsi(closes, 14);

    const i = bars.length - 1;
    const price = closes[i];
    const f = fast[i];
    const s = slow[i];
    const adxVal = adxData.adx[i];
    const rsiVal = rsiArr[i];

    if (!num(f) || !num(s) || !num(adxVal) || s === 0) return null;

    const direction = f > s ? 1 : -1;
    const emaSepPct = Math.abs((f - s) / s) * 100;

    const retIdx = i - returnLb;
    const returnPct = (retIdx >= 0 && closes[retIdx] > 0)
      ? ((price - closes[retIdx]) / closes[retIdx]) * 100
      : null;

    const adxOk = adxVal >= adxMin;
    const emaOk = emaSepPct >= emaSepMin;
    const returnOk = num(returnPct) && Math.abs(returnPct) >= returnMin && ((returnPct > 0) === (direction === 1));
    const regimeValid = adxOk && emaOk && returnOk;

    return {
      direction: direction,
      adx: adxVal,
      adxStrong: adxVal >= adxStrong,
      rsi: rsiVal,
      emaSepPct: emaSepPct,
      returnPct: returnPct,
      regimeValid: regimeValid,
      price: price,
      fast: f,
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
    const cached = _cache.get(tf);

    if (cached && cached.result != null && cached.version === version) {
      return cached.result;
    }

    const result = analyzeTimeframe(cleaned);
    if (result != null) {
      _cache.set(tf, { version: version, result: result });
    } else {
      _cache.delete(tf);
    }
    return result;
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

  function collectMultiTfLevels(perTf, barsByTf, currentPrice) {
    const allSupports = [];
    const allResistances = [];
    const tfs = Object.keys(perTf || {});

    for (let i = 0; i < tfs.length; i++) {
      const tf = tfs[i];
      const raw = barsByTf[tf];
      if (!raw || !raw.length) continue;
      const bars = cleanBars(raw);
      const tfData = perTf[tf];
      if (!tfData) continue;

      const atrApprox = tfData.price * 0.002;
      const levels = findLevelZones(bars, currentPrice, { lookback: 3, maxZones: 2, atr: atrApprox });
      levels.supports.forEach(function (s) {
        allSupports.push({ tf: tf, price: s.price, touches: s.touches, strength: s.strength });
      });
      levels.resistances.forEach(function (r) {
        allResistances.push({ tf: tf, price: r.price, touches: r.touches, strength: r.strength });
      });
    }

    function clusterMultiTf(list) {
      if (!list.length) return [];
      const sorted = list.slice().sort(function (a, b) { return a.price - b.price; });
      const groups = [];
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i];
        const tol = currentPrice * 0.002;
        let matched = null;
        for (let g = 0; g < groups.length; g++) {
          if (Math.abs(groups[g].avgPrice - p.price) <= tol) { matched = groups[g]; break; }
        }
        if (matched) {
          matched.prices.push(p.price);
          matched.tfs.push(p.tf);
          matched.touches += p.touches;
          matched.count++;
          matched.avgPrice = matched.prices.reduce(function (s, v) { return s + v; }, 0) / matched.prices.length;
        } else {
          groups.push({
            avgPrice: p.price,
            prices: [p.price],
            tfs: [p.tf],
            touches: p.touches,
            count: 1
          });
        }
      }
      return groups.map(function (g) {
        return {
          price: g.avgPrice,
          tfs: g.tfs,
          tfCount: g.count,
          touches: g.touches,
          strength: Math.min(100, g.count * 25 + g.touches * 10)
        };
      }).sort(function (a, b) { return b.strength - a.strength; });
    }

    return {
      supports: clusterMultiTf(allSupports),
      resistances: clusterMultiTf(allResistances)
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

  function detectRsiDivergence(closes, rsiArr) {
    const aCfg = cfg().anticipation || {};
    const lookback = aCfg.rsiDivergenceLookback || 8;
    const gap = aCfg.rsiDivergenceGap || 1;
    const minDelta = aCfg.rsiDivergenceMinDelta || 2;
    const n = closes.length;

    if (n < 2 * lookback + gap) return null;

    const currStart = n - lookback;
    const prevEnd = currStart - gap - 1;
    const prevStart = prevEnd - lookback + 1;

    if (prevStart < 0) return null;

    const currLow = findExtremeIdx(closes, currStart, n - 1, true);
    const prevLow = findExtremeIdx(closes, prevStart, prevEnd, true);

    if (currLow.idx !== -1 && prevLow.idx !== -1 &&
        currLow.val < prevLow.val &&
        num(rsiArr[currLow.idx]) && num(rsiArr[prevLow.idx]) &&
        (rsiArr[currLow.idx] - rsiArr[prevLow.idx]) >= minDelta) {
      return 'bullish';
    }

    const currHigh = findExtremeIdx(closes, currStart, n - 1, false);
    const prevHigh = findExtremeIdx(closes, prevStart, prevEnd, false);

    if (currHigh.idx !== -1 && prevHigh.idx !== -1 &&
        currHigh.val > prevHigh.val &&
        num(rsiArr[currHigh.idx]) && num(rsiArr[prevHigh.idx]) &&
        (rsiArr[prevHigh.idx] - rsiArr[currHigh.idx]) >= minDelta) {
      return 'bearish';
    }

    return null;
  }

  function detectMacdDivergence(closes, macdArr) {
    const aCfg = cfg().anticipation || {};
    if (aCfg.macdEnabled === false) return null;

    const lookback = aCfg.rsiDivergenceLookback || 8;
    const gap = aCfg.rsiDivergenceGap || 1;
    const n = closes.length;

    if (n < 2 * lookback + gap) return null;

    const currStart = n - lookback;
    const prevEnd = currStart - gap - 1;
    const prevStart = prevEnd - lookback + 1;

    if (prevStart < 0) return null;

    const currLow = findExtremeIdx(closes, currStart, n - 1, true);
    const prevLow = findExtremeIdx(closes, prevStart, prevEnd, true);

    if (currLow.idx !== -1 && prevLow.idx !== -1 &&
        currLow.val < prevLow.val &&
        num(macdArr[currLow.idx]) && num(macdArr[prevLow.idx]) &&
        macdArr[currLow.idx] > macdArr[prevLow.idx]) {
      return 'bullish';
    }

    const currHigh = findExtremeIdx(closes, currStart, n - 1, false);
    const prevHigh = findExtremeIdx(closes, prevStart, prevEnd, false);

    if (currHigh.idx !== -1 && prevHigh.idx !== -1 &&
        currHigh.val > prevHigh.val &&
        num(macdArr[currHigh.idx]) && num(macdArr[prevHigh.idx]) &&
        macdArr[currHigh.idx] < macdArr[prevHigh.idx]) {
      return 'bearish';
    }

    return null;
  }

  function detectSweep(bars, levels) {
    const aCfg = cfg().anticipation || {};
    if (aCfg.sweepEnabled === false) return null;

    const lookback = aCfg.sweepLookback || 10;
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

  function detectAnticipation(bars, levels, atrVal, currentPrice) {
    const aCfg = cfg().anticipation || {};
    if (aCfg.enabled === false || !bars || bars.length < 30) return null;

    const closes = bars.map(function (b) { return b.c; });
    const rsiArr = I.rsi(closes, 14);
    const macdData = I.macd(closes, aCfg.macdFast || 12, aCfg.macdSlow || 26, aCfg.macdSignal || 9);
    const macdArr = macdData.macd;

    const patterns = detectPatterns(bars);
    const rsiDiv = detectRsiDivergence(closes, rsiArr);
    const macdDiv = detectMacdDivergence(closes, macdArr);
    const sweep = detectSweep(bars, levels);

    let buyScore = 0;
    let sellScore = 0;
    const buyFactors = [];
    const sellFactors = [];

    if (rsiDiv === 'bullish') { buyScore += (aCfg.scoreRsiDivergence || 25); buyFactors.push('Divergencia RSI alcista'); }
    else if (rsiDiv === 'bearish') { sellScore += (aCfg.scoreRsiDivergence || 25); sellFactors.push('Divergencia RSI bajista'); }

    if (macdDiv === 'bullish') { buyScore += (aCfg.scoreMacdDivergence || 20); buyFactors.push('Divergencia MACD alcista'); }
    else if (macdDiv === 'bearish') { sellScore += (aCfg.scoreMacdDivergence || 20); sellFactors.push('Divergencia MACD bajista'); }

    if (patterns.pinBar === 'bullish') { buyScore += (aCfg.scorePinBar || 20); buyFactors.push('Pin Bar alcista'); }
    else if (patterns.pinBar === 'bearish') { sellScore += (aCfg.scorePinBar || 20); sellFactors.push('Pin Bar bajista'); }

    if (patterns.engulfing === 'bullish') { buyScore += (aCfg.scoreEngulfing || 15); buyFactors.push('Envolvente alcista'); }
    else if (patterns.engulfing === 'bearish') { sellScore += (aCfg.scoreEngulfing || 15); sellFactors.push('Envolvente bajista'); }

    if (sweep === 'bullish') { buyScore += (aCfg.scoreSweep || 20); buyFactors.push('Barrido de mínimos (Sweep)'); }
    else if (sweep === 'bearish') { sellScore += (aCfg.scoreSweep || 20); sellFactors.push('Barrido de máximos (Sweep)'); }

    const prox = aCfg.minLevelProximityAtr || 0.8;
    const nearSupport = levels.bestSupport && currentPrice && (currentPrice - levels.bestSupport.price) <= (atrVal * prox);
    const nearResistance = levels.bestResistance && currentPrice && (levels.bestResistance.price - currentPrice) <= (atrVal * prox);

    if (!nearSupport) {
      buyScore = Math.max(0, buyScore - 20);
    }
    if (!nearResistance) {
      sellScore = Math.max(0, sellScore - 20);
    }

    let type = null;
    let score = 0;
    let factors = [];

    if (buyScore > sellScore && buyScore >= (aCfg.minConfidence || 55)) {
      type = 'buy';
      score = Math.min(100, buyScore);
      factors = buyFactors;
    } else if (sellScore > buyScore && sellScore >= (aCfg.minConfidence || 55)) {
      type = 'sell';
      score = Math.min(100, sellScore);
      factors = sellFactors;
    }

    if (!type) return null;

    return {
      type: type,
      score: score,
      confidence: score,
      factors: factors,
      strength: score >= (aCfg.strongConfidence || 80) ? 'strong' : 'moderate'
    };
  }

  function suggestRisk(entry, support, resistance, atr, direction) {
    const riskCfg = cfg().risk || {};
    const stopMult = riskCfg.atrStopMult || 1.5;
    const targetMult = riskCfg.atrTargetMult || 3.0;
    const minRR = riskCfg.minRR || 1.8;
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
      else sellWeight += valid[i].data.evidence;
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
    let buyWeight = 0, sellWeight = 0;
    const byTf = {};
    for (let i = 0; i < valid.length; i++) {
      const v = valid[i];
      const d = v.data.direction;
      const w = v.data.weight || 1;
      byTf[v.tf] = d;
      if (d === 1) { buy++; buyWeight += w; }
      else if (d === -1) { sell++; sellWeight += w; }
      else neutral++;
    }
    return { buy, sell, neutral, total: valid.length, buyWeight, sellWeight, byTf };
  }

  function computeMultiTfSignal(valid, marketOpen) {
    if (!marketOpen) {
      return {
        action: 'wait', strength: 'closed', alignment: 0,
        votes: { buy: 0, sell: 0, neutral: 0, total: 0, byTf: {} },
        summary: 'Mercado cerrado.'
      };
    }
    if (!valid.length) {
      return {
        action: 'wait', strength: 'none', alignment: 0,
        votes: { buy: 0, sell: 0, neutral: 0, total: 0, byTf: {} },
        summary: 'Sin temporalidades analizadas.'
      };
    }

    const votes = computeVoteBreakdown(valid);
    const decided = votes.buy + votes.sell;
    const winning = Math.max(votes.buy, votes.sell);
    const alignment = decided > 0 ? (winning / decided) * 100 : 0;

    let action = 'wait';
    let strength = 'weak';

    if (votes.buy > votes.sell && alignment >= 55) {
      action = 'buy';
      strength = (alignment >= 75 && votes.buy >= 3) ? 'strong'
        : (alignment >= 60 && votes.buy >= 2) ? 'moderate'
        : 'weak';
    } else if (votes.sell > votes.buy && alignment >= 55) {
      action = 'sell';
      strength = (alignment >= 75 && votes.sell >= 3) ? 'strong'
        : (alignment >= 60 && votes.sell >= 2) ? 'moderate'
        : 'weak';
    }

    const summary =
      votes.buy + '/' + votes.total + ' alcistas · ' +
      votes.sell + '/' + votes.total + ' bajistas · ' +
      votes.neutral + ' neutras (alineación ' + alignment.toFixed(0) + '%)';

    return { action, strength, alignment, votes, summary };
  }

  function computeVerdict(ctx) {
    if (!ctx.marketOpen) {
      return { state: 'wait', label: 'ESPERAR', reason: 'Mercado cerrado (' + ctx.marketFamily + ').' };
    }

    if (ctx.anticipation && ctx.anticipation.strength === 'strong') {
      const aDir = ctx.anticipation.type === 'buy' ? 1 : -1;
      const agrees = ctx.overallDirection === 0 || aDir === ctx.overallDirection;
      if (agrees) {
        const isBuy = aDir === 1;
        return {
          state: isBuy ? 'buy' : 'sell',
          label: isBuy ? '¡COMPRAR AHORA! (Anticipación)' : '¡VENDER AHORA! (Anticipación)',
          reason: 'Fuerte confluencia anticipada: ' + ctx.anticipation.factors.join(', ') + '.'
        };
      } else {
        const isBuy = aDir === 1;
        return {
          state: isBuy ? 'buy' : 'sell',
          label: isBuy ? '¡COMPRAR AHORA! (Contra-tendencia)' : '¡VENDER AHORA! (Contra-tendencia)',
          reason: 'Anticipación contra tendencia principal. ' + ctx.anticipation.factors.join(', ') + '.'
        };
      }
    }

    if (ctx.overallDirection === 0) {
      return {
        state: 'wait', label: 'ESPERAR',
        reason: 'Votación ponderada sin sesgo claro (' + (ctx.buyShare * 100).toFixed(0) + '% / ' + ((1 - ctx.buyShare) * 100).toFixed(0) + '%).'
      };
    }
    if (!ctx.biasValid && ctx.consensusScore < 75) {
      return {
        state: 'wait', label: 'ESPERAR',
        reason: 'Sesgo ' + (ctx.overallDirection === 1 ? 'alcista' : 'bajista') +
          ' sin confirmación de ' + biasTfs().join('/') + ' (consenso ' + ctx.consensusScore.toFixed(0) + '%).'
      };
    }
    if (ctx.avgAdxAligned < ctx.adxMin) {
      return { state: 'wait', label: 'ESPERAR', reason: 'Régimen débil (ADX ' + ctx.avgAdxAligned.toFixed(1) + ' < ' + ctx.adxMin + ').' };
    }
    if (ctx.consensusLabel === 'neutral') {
      return { state: 'wait', label: 'ESPERAR', reason: 'Consenso insuficiente (' + ctx.consensusScore.toFixed(0) + '%).' };
    }
    if (ctx.dangerCount >= ctx.dangerBlock) {
      return { state: 'wait', label: 'ESPERAR', reason: 'Agotamiento detectado (' + ctx.dangerCount + ' alertas críticas).' };
    }
    if (!ctx.risk) {
      return { state: 'wait', label: 'ESPERAR', reason: 'No se pudo calcular gestión de riesgo.' };
    }
    if (!ctx.risk.valid) {
      return { state: 'wait', label: 'ESPERAR', reason: 'R:R ' + ctx.risk.rr.toFixed(2) + ':1 por debajo del mínimo (' + ctx.minRR + ':1).' };
    }

    const isBuy = ctx.overallDirection === 1;
    let finalLabel = isBuy ? 'PREPARAR COMPRA' : 'PREPARAR VENTA';
    let extra = '';

    if (ctx.proximitySignal && (ctx.proximitySignal.type === 'strong_buy' || ctx.proximitySignal.type === 'strong_sell')) {
      const proxDir = ctx.proximitySignal.type === 'strong_buy' ? 1 : -1;
      if (proxDir === ctx.overallDirection) {
        finalLabel = isBuy ? '¡COMPRAR AHORA!' : '¡VENDER AHORA!';
        extra = ' 📍 ' + ctx.proximitySignal.label + ' @ ' + ctx.fmt(ctx.proximitySignal.level);
      }
    }

    if (ctx.anticipation) {
      extra += ' ⚡ ' + ctx.anticipation.factors.join(', ');
    }

    return {
      state: isBuy ? 'buy' : 'sell',
      label: finalLabel,
      reason: 'Sesgo ' + (isBuy ? 'alcista' : 'bajista') +
        ' confirmado. ADX ' + ctx.avgAdxAligned.toFixed(1) +
        ' · R:R ' + ctx.risk.rr.toFixed(2) + ':1 · Stop ' + ctx.fmt(ctx.risk.stop) +
        ' · Target ' + ctx.fmt(ctx.risk.target) + '.' + extra
    };
  }

  function emptyResult(reason, sessionLabel, marketOpen, symbolFamily) {
    return {
      consensusScore: 0,
      consensusLabel: 'neutral',
      consensusText: LABELS.neutral,
      confidence: 0,
      overallDirection: 0,
      perTf: {},
      macroTrend: '—',
      macroMomentum: '—',
      macroVolatility: '—',
      avgAdxAligned: 0,
      avgAdxOpposed: 0,
      alerts: [],
      verdictState: 'wait',
      verdictLabel: 'ESPERAR',
      verdictReason: reason || 'Datos insuficientes.',
      verdictRisk: null,
      marketOpen: !!marketOpen,
      highLiquidity: false,
      sessionLabel: sessionLabel || SESSION_LABELS.closed,
      symbolFamily: symbolFamily || 'unknown',
      entryTf: null,
      levels: { supports: [], resistances: [], bestSupport: null, bestResistance: null },
      levelZonesMultiTf: { supports: [], resistances: [] },
      proximitySignal: null,
      anticipation: null,
      multiTfSignal: {
        action: 'wait', strength: 'none', alignment: 0,
        votes: { buy: 0, sell: 0, neutral: 0, total: 0, byTf: {} },
        summary: reason || 'Datos insuficientes.'
      },
      conclusion: reason || 'Datos insuficientes.',
      computedAt: Date.now()
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
    const thresholds = consensusCfg.thresholds || { strong: 65, moderate: 45 };
    const minValidTfs = consensusCfg.minimumValidTfs || 2;
    const weightedMajority = consensusCfg.weightedMajority || 0.60;
    const adxMin = regimeCfg.adxMin || 22;
    const dangerBlock = exCfg.dangerBlockThreshold || 2;
    const minRR = riskCfg.minRR || 1.8;

    const entryTf = opts.currentTf || (c.timeframes && c.timeframes.entry) || '15m';
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
        valid.push({ tf: tf, data: r });
      } catch (e) {
        console.error('[analysis] ' + tf + ' excepción:', e);
      }
    }

    if (valid.length === 0) {
      return emptyResult(
        'Datos insuficientes: no se ha podido analizar ninguna temporalidad.',
        sessionLabel, marketState.open, marketState.family
      );
    }

    const consensus = computeConsensus(valid, thresholds, weightedMajority);
    const overallDirection = consensus.overallDirection;
    const buyShare = consensus.buyShare;
    const consensusScore = consensus.consensusScore;
    const consensusLabel = consensus.consensusLabel;
    const avgAdxAligned = consensus.avgAdxAligned;
    const avgAdxOpposed = consensus.avgAdxOpposed;
    const confidence = consensus.confidence;

    const multiTfSignal = computeMultiTfSignal(valid, marketState.open);

    const bias = biasTfs();
    const biasAgree = valid.filter(function (v) {
      return bias.indexOf(v.tf) !== -1 && v.data.regimeValid && v.data.direction === overallDirection;
    });
    const biasOppose = valid.filter(function (v) {
      return bias.indexOf(v.tf) !== -1 && v.data.regimeValid && overallDirection !== 0 && v.data.direction !== overallDirection;
    });
    const biasValid = overallDirection !== 0 && biasAgree.length >= 1 && biasOppose.length === 0;

    const macroTrend =
      avgAdxAligned >= 30 ? 'Muy fuerte' :
      avgAdxAligned >= 25 ? 'Fuerte' :
      avgAdxAligned >= 20 ? 'Moderada' : 'Débil';

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
      if (num(lastRsi)) {
        macroMomentum = lastRsi >= 60 ? 'Alcista' : lastRsi <= 40 ? 'Bajista' : 'Neutro';
      }

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

      const overext = exCfg.consensusOverextension || 95;
      if (consensusScore >= overext && overallDirection === 1) {
        alerts.push({ type: 'danger', text: 'Consenso unánime alcista. Riesgo de sobre-extensión.' });
      } else if (consensusScore >= overext && overallDirection === -1) {
        alerts.push({ type: 'danger', text: 'Consenso unánime bajista. Riesgo de sobre-extensión.' });
      }
    }

    if (marketState.open && !liquidityState.overlap && !marketState.alwaysOpen) {
      alerts.push({ type: 'info', text: 'Liquidez reducida (fuera de overlap Londres-NY).' });
    }

    const entryData = perTf[entryTf];
    const currentPrice = entryData ? entryData.price : (valid[0] ? valid[0].data.price : null);
    const levels = findLevelZones(entryBars, currentPrice, { lookback: 3, maxZones: 3, atr: atrVal });
    const levelZonesMultiTf = collectMultiTfLevels(perTf, barsByTf, currentPrice || 0);

    const riskLevels = {
      support: levels.bestSupport ? levels.bestSupport.price : null,
      resistance: levels.bestResistance ? levels.bestResistance.price : null
    };
    const risk = overallDirection !== 0
      ? suggestRisk(currentPrice, riskLevels.support, riskLevels.resistance, atrVal, overallDirection)
      : null;

    const proxSignal = proximitySignal(
      currentPrice, atrVal, levels,
      overallDirection || 0,
      entryData ? entryData.rsi : null
    );

    const anticipation = entryBars
      ? detectAnticipation(entryBars, levels, atrVal, currentPrice)
      : null;

    const digits = (c.symbols && c.symbols[symbol] && c.symbols[symbol].digits) || 2;
    const fmt = function (p) { return num(p) ? p.toFixed(digits) : '—'; };
    const dangerCount = alerts.filter(function (a) { return a.type === 'danger'; }).length;

    let verdict;

    if (valid.length < minValidTfs) {
      verdict = {
        state: 'wait',
        label: 'ESPERAR',
        reason: 'Faltan temporalidades: ' + valid.length + ' de ' + minValidTfs + ' mínimas (cargando datos...).'
      };
    } else {
      verdict = computeVerdict({
        marketOpen: marketState.open,
        marketFamily: marketState.family,
        overallDirection: overallDirection,
        buyShare: buyShare,
        biasValid: biasValid,
        avgAdxAligned: avgAdxAligned,
        adxMin: adxMin,
        consensusLabel: consensusLabel,
        consensusScore: consensusScore,
        dangerCount: dangerCount,
        dangerBlock: dangerBlock,
        risk: risk,
        minRR: minRR,
        proximitySignal: proxSignal,
        anticipation: anticipation,
        fmt: fmt
      });
    }

    const conclusionParts = [];
    const dirText = overallDirection === 1 ? 'alcista' : overallDirection === -1 ? 'bajista' : 'neutral';

    if (!marketState.open) {
      conclusionParts.push('Mercado cerrado para ' + symbol + ' (' + marketState.family + ').');
    } else {
      conclusionParts.push('Análisis multi-TF: ' + multiTfSignal.summary + '.');

      if (multiTfSignal.action === 'buy') {
        conclusionParts.push('Señal consolidada: COMPRAR (' + multiTfSignal.strength + ').');
      } else if (multiTfSignal.action === 'sell') {
        conclusionParts.push('Señal consolidada: VENDER (' + multiTfSignal.strength + ').');
      } else {
        conclusionParts.push('Sin señal consolidada clara.');
      }

      if (anticipation) {
        conclusionParts.push('Anticipación ' + anticipation.type + ' (' + anticipation.score + '%): ' + anticipation.factors.join(', ') + '.');
      }

      if (verdict.state === 'buy' || verdict.state === 'sell') {
        conclusionParts.push('Setup de precisión: ' + verdict.label + ' (consenso ' + consensusScore.toFixed(0) + '%, confianza ' + confidence.toFixed(0) + '%).');
        if (proxSignal && (proxSignal.type === 'strong_buy' || proxSignal.type === 'strong_sell')) {
          conclusionParts.push('Proximidad: ' + proxSignal.label + ' @ ' + fmt(proxSignal.level) + ' (' + proxSignal.touches + ' toques).');
        }
      } else {
        conclusionParts.push('Precisión: ' + verdict.reason);
      }
    }

    return {
      consensusScore: consensusScore,
      consensusLabel: consensusLabel,
      consensusText: LABELS[consensusLabel],
      confidence: confidence,
      overallDirection: overallDirection,
      perTf: perTf,
      macroTrend: macroTrend,
      macroMomentum: macroMomentum,
      macroVolatility: macroVolatility,
      avgAdxAligned: avgAdxAligned,
      avgAdxOpposed: avgAdxOpposed,
      alerts: alerts,
      verdictState: verdict.state,
      verdictLabel: verdict.label,
      verdictReason: verdict.reason,
      verdictRisk: risk,
      levels: levels,
      levelZonesMultiTf: levelZonesMultiTf,
      proximitySignal: proxSignal,
      anticipation: anticipation,
      multiTfSignal: multiTfSignal,
      marketOpen: marketState.open,
      highLiquidity: liquidityState.overlap,
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
        if (strong && rsiOk) {
          return { type: 'strong_buy', label: 'SOPORTE FUERTE — COMPRAR', level: levels.bestSupport.price, distance: dist, touches: levels.bestSupport.touches };
        }
        return { type: 'buy', label: 'Cerca de soporte', level: levels.bestSupport.price, distance: dist, touches: levels.bestSupport.touches };
      }
    }

    if (direction === -1 && levels.bestResistance) {
      const dist = levels.bestResistance.price - currentPrice;
      if (dist >= 0 && dist <= nearDist) {
        const strong = levels.bestResistance.touches >= 2;
        const rsiOk = !num(rsiVal) || rsiVal > 45;
        if (strong && rsiOk) {
          return { type: 'strong_sell', label: 'RESISTENCIA FUERTE — VENDER', level: levels.bestResistance.price, distance: dist, touches: levels.bestResistance.touches };
        }
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
    const vols = bars.map(function (b) { return b.v || 0; });

    const i = bars.length - 1;
    const rsiArr = I.rsi(closes, exCfg.rsiPeriod || 14);
    const adxArr = I.adx(highs, lows, closes, 14).adx;

    const lastRsi = rsiArr[i];
    const prevRsi = rsiArr[i - 1];
    const ob = exCfg.rsiOverbought || 80;
    const os = exCfg.rsiOversold || 20;
    if (num(lastRsi) && num(prevRsi)) {
      if (lastRsi > ob && prevRsi <= ob) {
        alerts.push({ type: 'info', text: 'RSI cruza sobrecompra (' + lastRsi.toFixed(1) + ').' });
      } else if (lastRsi < os && prevRsi >= os) {
        alerts.push({ type: 'info', text: 'RSI cruza sobreventa (' + lastRsi.toFixed(1) + ').' });
      }
    }

    const lookback = exCfg.lookbackCandles || 5;
    if (i >= lookback && num(adxArr[i]) && num(adxArr[i - lookback]) && adxArr[i - lookback] > 0) {
      const dropPct = ((adxArr[i - lookback] - adxArr[i]) / adxArr[i - lookback]) * 100;
      if (dropPct > (exCfg.adxDropPct || 30)) {
        alerts.push({ type: 'info', text: 'ADX cae ' + dropPct.toFixed(0) + '% en ' + lookback + ' velas.' });
      }
    }

    const divLb = exCfg.divergenceLookback || 15;
    const gap = exCfg.divergenceGap != null ? exCfg.divergenceGap : 1;
    if (i >= 2 * divLb + gap - 1) {
      const currStart = i - divLb + 1;
      const prevEnd = currStart - gap - 1;
      const prevStart = prevEnd - divLb + 1;

      const currLow = findExtremeIdx(lows, currStart, i, true);
      const prevLow = findExtremeIdx(lows, prevStart, prevEnd, true);
      if (currLow.idx !== -1 && prevLow.idx !== -1 &&
          currLow.val < prevLow.val &&
          num(rsiArr[currLow.idx]) && num(rsiArr[prevLow.idx]) &&
          rsiArr[currLow.idx] > rsiArr[prevLow.idx]) {
        alerts.push({ type: 'danger', text: 'Divergencia alcista RSI.' });
      }

      const currHigh = findExtremeIdx(highs, currStart, i, false);
      const prevHigh = findExtremeIdx(highs, prevStart, prevEnd, false);
      if (currHigh.idx !== -1 && prevHigh.idx !== -1 &&
          currHigh.val > prevHigh.val &&
          num(rsiArr[currHigh.idx]) && num(rsiArr[prevHigh.idx]) &&
          rsiArr[currHigh.idx] < rsiArr[prevHigh.idx]) {
        alerts.push({ type: 'danger', text: 'Divergencia bajista RSI.' });
      }
    }

    const volLb = exCfg.volumeLookback || 20;
    if (i > volLb) {
      let avgVol = 0;
      for (let j = i - 1; j >= i - volLb; j--) avgVol += vols[j];
      avgVol /= volLb;
      const lastVol = vols[i];
      const isBearish = closes[i] < bars[i].o;
      const isBullish = closes[i] > bars[i].o;
      const threshold = avgVol * (1 - (exCfg.volumeDropPct || 40) / 100);
      if (direction === -1 && isBearish && lastVol < threshold) {
        alerts.push({ type: 'warn', text: 'Volumen bajo en vela bajista.' });
      } else if (direction === 1 && isBullish && lastVol < threshold) {
        alerts.push({ type: 'warn', text: 'Volumen bajo en vela alcista.' });
      }
    }

    return alerts;
  }

  function invalidateCache() {
    _cache.clear();
  }

  return {
    analyze: analyze,
    invalidateCache: invalidateCache,
    LABELS: LABELS,
    SESSION_LABELS: SESSION_LABELS,
    getMarketState: getMarketState,
    getLiquidityState: getLiquidityState,
    getSessionLabel: getSessionLabel
  };
}));