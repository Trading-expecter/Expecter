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

  function num(v) { return v != null && Number.isFinite(v); }
  function cfg() { return (typeof window !== 'undefined' && window.AT_CONFIG) || {}; }

  function weightFor(tf) {
    const w = (cfg().timeframes && cfg().timeframes.weights) || {};
    return w[tf] || 1;
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
    const useClosed = (cfg().analysis && cfg().analysis.useClosedCandlesOnly) === true;
    if (useClosed && bars.length > 1) return bars.slice(0, -1);
    return bars;
  }

  function getTradingHours(family) {
    const th = cfg().tradingHours || {};
    const fallback = { alwaysOpen: false, open: { day: 0, hour: 22 }, close: { day: 5, hour: 22 } };
    return th[family] || th.forex || fallback;
  }

  function getMarketState(symbol, now) {
    const inst = (cfg().symbols || {})[symbol];
    if (!inst) return { open: false, family: 'unknown', alwaysOpen: false, currentMin: 0, openMin: 0, closeMin: 0 };
    const family = inst.family || 'forex';
    const th = getTradingHours(family);
    if (th.alwaysOpen) return { open: true, family: family, alwaysOpen: true, currentMin: 0, openMin: 0, closeMin: 0 };
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const currentMin = dow * 24 * 60 + hour * 60 + minute;
    const openMin = (th.open.day * 24 * 60) + (th.open.hour * 60);
    const closeMin = (th.close.day * 24 * 60) + (th.close.hour * 60);
    const open = currentMin >= openMin && currentMin < closeMin;
    return { open: open, family: family, alwaysOpen: false, currentMin: currentMin, openMin: openMin, closeMin: closeMin };
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
      hour: hour
    };
  }

  function getSessionLabel(marketState, liquidityState) {
    if (!marketState.open) return SESSION_LABELS.closed;
    if (marketState.alwaysOpen) {
      if (liquidityState.overlap) return SESSION_LABELS.highLiquidity;
      return SESSION_LABELS.alwaysOpen;
    }
    if (liquidityState.overlap) return SESSION_LABELS.highLiquidity;
    if (liquidityState.london) return SESSION_LABELS.european;
    if (liquidityState.newYork) return SESSION_LABELS.american;
    return SESSION_LABELS.asian;
  }

  function analyzeTimeframe(bars) {
    const minBars = (cfg().analysis && cfg().analysis.minBarsPerTf) || 15;
    if (!bars || bars.length < minBars) return null;

    const closes = bars.map(function (b) { return b.c; });
    const highs = bars.map(function (b) { return b.h; });
    const lows = bars.map(function (b) { return b.l; });

    const rCfg = cfg().regime || {};
    const emaFastP = rCfg.emaFast || 9;
    const emaSlowP = rCfg.emaSlow || 21;
    const adxPeriod = rCfg.adxPeriod || 14;
    const returnLb = rCfg.returnLookback || 10;
    const emaSepMin = rCfg.emaSeparationMinPct || 0.05;
    const returnMin = rCfg.returnMinPct || 0.02;

    const fast = I.ema(closes, emaFastP);
    const slow = I.ema(closes, emaSlowP);
    const adxData = I.adx(highs, lows, closes, adxPeriod);

    const i = bars.length - 1;
    const price = closes[i];
    const f = fast[i];
    const s = slow[i];
    const adxVal = adxData.adx[i] || 0;

    if (!num(f) || !num(s) || s === 0) return null;

    const direction = f > s ? 1 : -1;
    const emaSepPct = Math.abs((f - s) / s) * 100;

    const retIdx = i - returnLb;
    let returnPct = null;
    if (retIdx >= 0 && closes[retIdx] > 0) {
      returnPct = ((price - closes[retIdx]) / closes[retIdx]) * 100;
    }

    const adxOk = adxVal >= (rCfg.adxMin || 18);
    const emaOk = emaSepPct >= emaSepMin;
    const returnOk = num(returnPct) && Math.abs(returnPct) >= returnMin && ((returnPct > 0) === (direction === 1));
    const regimeValid = adxOk && emaOk && returnOk;

    return {
      direction: direction,
      adx: adxVal,
      adxStrong: adxVal >= (rCfg.adxStrong || 25),
      emaSepPct: emaSepPct,
      returnPct: returnPct,
      regimeValid: regimeValid,
      price: price,
      fast: f,
      slow: s,
      plusDI: adxData.plusDI[i],
      minusDI: adxData.minusDI[i],
      bars: bars.length
    };
  }

  function findNearestLevels(bars, currentPrice, lookback) {
    lookback = lookback || 3;
    if (!bars || bars.length < lookback * 2 + 2) return { support: null, resistance: null };
    const supports = [];
    const resistances = [];

    for (let i = lookback; i < bars.length - lookback; i++) {
      const b = bars[i];
      let isHigh = true;
      let isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (bars[i - j].h >= b.h || bars[i + j].h >= b.h) isHigh = false;
        if (bars[i - j].l <= b.l || bars[i + j].l <= b.l) isLow = false;
      }
      if (isHigh) {
        if (b.h < currentPrice) supports.push(b.h);
        else resistances.push(b.h);
      }
      if (isLow) {
        if (b.l < currentPrice) supports.push(b.l);
        else resistances.push(b.l);
      }
    }

    return {
      support: supports.length ? Math.max.apply(null, supports) : null,
      resistance: resistances.length ? Math.min.apply(null, resistances) : null
    };
  }

  function suggestRisk(entry, support, resistance, atr, direction) {
    const riskCfg = cfg().risk || {};
    const stopMult = riskCfg.atrStopMult || 1.2;
    const targetMult = riskCfg.atrTargetMult || 1.8;
    const minRR = riskCfg.minRR || 1.2;
    if (!num(entry) || !num(atr) || atr <= 0) return null;

    let stop, target, risk, reward;
    if (direction === 1) {
      const atrStop = entry - stopMult * atr;
      stop = num(support) ? Math.min(support, atrStop) : atrStop;
      const atrTarget = entry + targetMult * atr;
      target = num(resistance) ? Math.min(resistance, atrTarget) : atrTarget;
      if (target <= entry) return null;
      risk = entry - stop;
      reward = target - entry;
    } else if (direction === -1) {
      const atrStop = entry + stopMult * atr;
      stop = num(resistance) ? Math.max(resistance, atrStop) : atrStop;
      const atrTarget = entry - targetMult * atr;
      target = num(support) ? Math.max(support, atrTarget) : atrTarget;
      if (target >= entry) return null;
      risk = stop - entry;
      reward = entry - target;
    } else {
      return null;
    }

    if (risk <= 0 || reward <= 0) return null;
    const rr = reward / risk;
    return { stop: stop, target: target, rr: rr, valid: rr >= minRR };
  }

  function detectExhaustion(bars, direction, exCfg) {
    const alerts = [];
    if (!bars || bars.length < 20) return alerts;

    const closes = bars.map(function (b) { return b.c; });
    const highs = bars.map(function (b) { return b.h; });
    const lows = bars.map(function (b) { return b.l; });
    const vols = bars.map(function (b) { return b.v || 0; });

    const i = bars.length - 1;
    const rsiPeriod = exCfg.rsiPeriod || 14;
    const rsiArr = I.rsi(closes, rsiPeriod);
    const lastRsi = rsiArr[i];
    const prevRsi = rsiArr[i - 1];
    const ob = exCfg.rsiOverbought || 75;
    const os = exCfg.rsiOversold || 25;

    if (num(lastRsi) && num(prevRsi)) {
      if (lastRsi > ob && prevRsi <= ob) {
        alerts.push({ type: 'info', text: 'RSI cruza sobrecompra (' + lastRsi.toFixed(1) + ').' });
      } else if (lastRsi < os && prevRsi >= os) {
        alerts.push({ type: 'info', text: 'RSI cruza sobreventa (' + lastRsi.toFixed(1) + ').' });
      }
    }
    return alerts;
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
      verdictReason: reason || 'Analizando mercado...',
      verdictRisk: null,
      marketOpen: marketOpen || false,
      highLiquidity: false,
      sessionLabel: sessionLabel || SESSION_LABELS.closed,
      symbolFamily: symbolFamily || 'unknown',
      entryTf: null,
      conclusion: reason || 'Analizando mercado...'
    };
  }

  function analyze(barsByTf, opts) {
    opts = opts || {};
    const c = cfg();
    const consensusCfg = c.consensus || {};
    const riskCfg = c.risk || {};
    const exCfg = c.exhaustion || {};
    const thresholds = consensusCfg.thresholds || { strong: 60, moderate: 40 };
    const minValidTfs = consensusCfg.minimumValidTfs || 1;
    const weightedMajority = consensusCfg.weightedMajority || 0.50;
    const dangerBlock = exCfg.dangerBlockThreshold || 3;
    const minRR = riskCfg.minRR || 1.2;

    const entryTf = opts.currentTf || (c.timeframes && c.timeframes.entry) || '5m';
    const symbol = opts.symbol || 'XAUUSD';

    const now = new Date();
    const marketState = getMarketState(symbol, now);
    const liquidityState = getLiquidityState(now);
    const sessionLabel = getSessionLabel(marketState, liquidityState);

    const tfs = Object.keys(barsByTf || {});
    const perTf = {};
    const valid = [];

    tfs.forEach(function (tf) {
      const bars = cleanBars(barsByTf[tf]);
      const r = analyzeTimeframe(bars);
      if (r) {
        r.adxNorm = normalizeAdx(r.adx);
        r.weight = weightFor(tf);
        r.evidence = r.weight * (r.adxNorm > 0 ? r.adxNorm : 0.5);
        perTf[tf] = r;
        valid.push({ tf: tf, data: r });
      }
    });

    if (valid.length === 0) {
      return emptyResult('Cargando datos de mercado o historial insuficiente...', sessionLabel, marketState.open, marketState.family);
    }

    let buyWeight = 0;
    let sellWeight = 0;
    valid.forEach(function (v) {
      const w = v.data.evidence;
      if (v.data.direction === 1) buyWeight += w;
      else sellWeight += w;
    });
    const totalWeight = buyWeight + sellWeight;
    const buyShare = totalWeight > 0 ? buyWeight / totalWeight : 0.5;

    let overallDirection = 0;
    if (buyShare >= weightedMajority) overallDirection = 1;
    else if (buyShare <= 1 - weightedMajority) overallDirection = -1;

    let sumAllEvidence = 0;
    let sumAgreeEvidence = 0;
    let sumAgreeAdx = 0;
    let agreeCount = 0;

    valid.forEach(function (v) {
      const agree = overallDirection !== 0 && v.data.direction === overallDirection;
      v.agree = agree;
      perTf[v.tf].agree = agree;
      sumAllEvidence += v.data.evidence;
      if (agree) {
        sumAgreeEvidence += v.data.evidence;
        sumAgreeAdx += v.data.adx;
        agreeCount++;
      }
    });

    const consensusScore = sumAllEvidence > 0 ? (sumAgreeEvidence / sumAllEvidence) * 100 : (overallDirection !== 0 ? 100 : 0);
    const avgAdxAligned = agreeCount > 0 ? sumAgreeAdx / agreeCount : 0;
    const magnitude = avgAdxAligned > 0 ? normalizeAdx(avgAdxAligned) : 0.5;
    const confidence = overallDirection !== 0 ? magnitude * (consensusScore / 100) * 100 : 0;

    let consensusLabel;
    if (overallDirection === 0) consensusLabel = 'neutral';
    else if (consensusScore >= thresholds.strong) consensusLabel = overallDirection === 1 ? 'strong_buy' : 'strong_sell';
    else if (consensusScore >= thresholds.moderate) consensusLabel = overallDirection === 1 ? 'buy' : 'sell';
    else consensusLabel = overallDirection === 1 ? 'buy' : 'sell';

    const entryBarsRaw = barsByTf[entryTf] || null;
    const entryBars = entryBarsRaw ? cleanBars(entryBarsRaw) : null;

    let macroMomentum = 'Neutro';
    let macroVolatility = 'Normal';
    let alerts = [];
    let atrVal = 0;

    if (entryBars && entryBars.length > 15) {
      const hc = entryBars.map(function (b) { return b.c; });
      const hh = entryBars.map(function (b) { return b.h; });
      const hl = entryBars.map(function (b) { return b.l; });

      const rsiArr = I.rsi(hc, 14);
      const lastRsi = rsiArr[rsiArr.length - 1];
      if (num(lastRsi)) {
        if (lastRsi >= 60) macroMomentum = 'Alcista';
        else if (lastRsi <= 40) macroMomentum = 'Bajista';
      }

      const atrArr = I.atr(hh, hl, hc, riskCfg.atrPeriod || 14);
      const lastAtr = atrArr[atrArr.length - 1];
      if (num(lastAtr)) atrVal = lastAtr;

      alerts = detectExhaustion(entryBars, overallDirection, exCfg);
    }

    const entryData = perTf[entryTf] || valid[0].data;
    const currentPrice = entryData.price;
    const levels = findNearestLevels(entryBars, currentPrice, 3);
    const risk = overallDirection !== 0 ? suggestRisk(currentPrice, levels.support, levels.resistance, atrVal, overallDirection) : null;

    let verdictState = 'wait';
    let verdictLabel = 'ESPERAR';
    let verdictReason = 'Analizando condiciones...';

    if (!marketState.open) {
      verdictReason = 'Mercado cerrado (' + marketState.family + ').';
    } else if (overallDirection === 0) {
      verdictReason = 'Mercado lateral. Se busca ruptura de estructura.';
    } else if (!risk) {
      verdictReason = 'Calculando niveles de entrada perfectos...';
    } else if (!risk.valid) {
      verdictReason = 'R:R ' + risk.rr.toFixed(2) + ':1 muy bajo. Esperando mejor punto.';
    } else {
      verdictState = overallDirection === 1 ? 'buy' : 'sell';
      verdictLabel = overallDirection === 1 ? 'COMPRA' : 'VENTA';
      verdictReason = 'Entrada: ' + currentPrice.toFixed(2) + ' | SL: ' + risk.stop.toFixed(2) + ' | TP: ' + risk.target.toFixed(2);
    }

    const conclusionParts = [];
    if (!marketState.open) {
      conclusionParts.push('Mercado cerrado.');
    } else {
      conclusionParts.push('Setup ' + (overallDirection === 1 ? 'Alcista' : overallDirection === -1 ? 'Bajista' : 'Neutro') + ' (' + consensusScore.toFixed(0) + '%).');
      conclusionParts.push(verdictReason);
    }

    return {
      consensusScore: consensusScore,
      consensusLabel: consensusLabel,
      consensusText: LABELS[consensusLabel],
      confidence: confidence,
      overallDirection: overallDirection,
      perTf: perTf,
      macroTrend: avgAdxAligned >= 25 ? 'Fuerte' : (avgAdxAligned >= 18 ? 'Moderada' : 'Débil'),
      macroMomentum: macroMomentum,
      macroVolatility: macroVolatility,
      avgAdxAligned: avgAdxAligned,
      alerts: alerts,
      verdictState: verdictState,
      verdictLabel: verdictLabel,
      verdictReason: verdictReason,
      verdictRisk: risk,
      marketOpen: marketState.open,
      highLiquidity: liquidityState.overlap,
      sessionLabel: sessionLabel,
      symbolFamily: marketState.family,
      entryTf: entryTf,
      conclusion: conclusionParts.join(' ')
    };
  }

  return {
    analyze: analyze,
    LABELS: LABELS,
    SESSION_LABELS: SESSION_LABELS,
    getMarketState: getMarketState,
    getLiquidityState: getLiquidityState,
    getSessionLabel: getSessionLabel
  };
}));