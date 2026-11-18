window.Engine = (function () {
  function evaluate(entryBars, contextBars, modeConfig, currentPrice) {
    const I = window.Indicators;
    const S = window.Structure;
    const Z = window.Zones;

    const empty = {
      active: false, direction: null, confidence: 'nula',
      entry: null, stop: null, target: null, riskReward: null,
      checklist: {
        trend: { valid: false, reason: 'Historial insuficiente' },
        structure: { valid: false, reason: 'Historial insuficiente' },
        zone: { valid: false, reason: 'Historial insuficiente' },
        momentum: { valid: false, reason: 'Historial insuficiente' }
      },
      reasons: [], zones: { ob: null, fvg: null }
    };

    if (!entryBars || entryBars.length < 40 || !contextBars || contextBars.length < 40) return empty;

    const entryCloses = entryBars.map(b => b.c);
    const entryHighs = entryBars.map(b => b.h);
    const entryLows = entryBars.map(b => b.l);
    const ctxCloses = contextBars.map(b => b.c);

    const emaFastCtx = I.ema(ctxCloses, modeConfig.emaFast);
    const emaSlowCtx = I.ema(ctxCloses, modeConfig.emaSlow);
    const lastFast = emaFastCtx[emaFastCtx.length - 1];
    const lastSlow = emaSlowCtx[emaSlowCtx.length - 1];

    const trendBull = lastFast != null && lastSlow != null && lastFast > lastSlow;
    const trendBear = lastFast != null && lastSlow != null && lastFast < lastSlow;
    const trendDir = trendBull ? 1 : trendBear ? -1 : 0;

    const atrArr = I.atr(entryHighs, entryLows, entryCloses, modeConfig.atrPeriod);
    let atr = atrArr[atrArr.length - 1];
    if (!Number.isFinite(atr) || atr <= 0) atr = currentPrice * 0.001;

    const pivots = S.pivots(entryBars, CONFIG.smc.swingLookback);
    const bos = S.detectBOS(entryBars, pivots);
    const choch = S.detectCHoCH(entryBars, pivots);
    const structure = bos || choch;

    const structureDir = structure ? structure.direction : 0;
    const structureAligned = structure && trendDir !== 0 && structureDir === trendDir;

    const fvgZones = Z.fvg(entryBars, atr);
    const obZones = Z.orderBlocks(entryBars, atr, trendDir || 1);
    const activeFvg = Z.activeZone(fvgZones.filter(z => z.direction === trendDir), currentPrice);
    const activeOb = Z.activeZone(obZones.filter(z => z.direction === trendDir), currentPrice);

    const rsiArr = I.rsi(entryCloses, modeConfig.rsiPeriod);
    const rsi = rsiArr[rsiArr.length - 1];

    const momentumValid = rsi != null && (
      (trendBull && rsi > 50 && rsi < 75) ||
      (trendBear && rsi < 50 && rsi > 25)
    );

    const checklist = {
      trend: {
        valid: trendBull || trendBear,
        reason: trendBull ? 'EMA50 > EMA200' : trendBear ? 'EMA50 < EMA200' : 'Tendencia no definida'
      },
      structure: {
        valid: structureAligned,
        reason: structure ? structure.type + (structureDir === 1 ? ' alcista' : ' bajista') : 'Sin BOS/CHoCH alineado'
      },
      zone: {
        valid: !!activeOb || !!activeFvg,
        reason: activeOb ? 'Order Block activo' : activeFvg ? 'Fair Value Gap activo' : 'Sin zona institucional'
      },
      momentum: {
        valid: momentumValid,
        reason: rsi != null ? 'RSI ' + rsi.toFixed(1) : 'RSI no disponible'
      }
    };

    const validCount = Object.values(checklist).filter(c => c.valid).length;
    const active = validCount >= modeConfig.minConfluences && trendDir !== 0 && structureAligned;

    let direction = null, entry = null, stop = null, target = null, riskReward = null;
    if (active) {
      direction = trendDir === 1 ? 'buy' : 'sell';
      entry = currentPrice;
      if (direction === 'buy') {
        stop = entry - atr * modeConfig.slAtrMult;
        target = entry + atr * modeConfig.tpAtrMult;
      } else {
        stop = entry + atr * modeConfig.slAtrMult;
        target = entry - atr * modeConfig.tpAtrMult;
      }
      riskReward = Math.abs(target - entry) / Math.abs(stop - entry);
    }

    const confidence = validCount === 4 ? 'alta'
                     : validCount === 3 ? 'media'
                     : validCount === 2 ? 'baja'
                     : 'nula';

    return {
      active, direction, confidence,
      entry, stop, target, riskReward,
      checklist,
      reasons: Object.values(checklist).filter(c => c.valid).map(c => c.reason),
      zones: { ob: activeOb, fvg: activeFvg }
    };
  }

  return { evaluate };
})();