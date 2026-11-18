/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * engine.js  (6/11)  ·  Motor de evaluación SMC
 * Estados: 'waiting' | 'armed' (PREPARAR) | 'active' (señal)
 * ============================================================ */
window.Engine = (function () {
  'use strict';

  const I = () => window.Indicators;
  const S = () => window.Structure;
  const Z = () => window.Zones;

  function emptyResult() {
    return {
      state: 'waiting', active: false, armed: false,
      direction: null, armedDirection: null, confidence: 'nula',
      entry: null, stop: null, target: null, riskReward: null,
      armedZone: null, armedDistance: null,
      checklist: {
        trend:     { valid: false, reason: 'Historial insuficiente' },
        structure: { valid: false, reason: 'Historial insuficiente' },
        zone:      { valid: false, reason: 'Historial insuficiente' },
        momentum:  { valid: false, reason: 'Historial insuficiente' }
      },
      reasons: [], zones: { ob: null, fvg: null }
    };
  }

  function evaluate(entryBars, contextBars, modeConfig, currentPrice) {
    const out = emptyResult();
    if (!entryBars || entryBars.length < 40 || !contextBars || contextBars.length < 40) return out;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return out;

    const Ind = I(), Str = S(), Zn = Z();

    // 1. Sesgo de tendencia (contexto: EMA50 vs EMA200)
    const ctxCloses = contextBars.map(b => b.c);
    const lastFast = Ind.lastFinite(Ind.ema(ctxCloses, modeConfig.emaFast));
    const lastSlow = Ind.lastFinite(Ind.ema(ctxCloses, modeConfig.emaSlow));
    const trendBull = lastFast != null && lastSlow != null && lastFast > lastSlow;
    const trendBear = lastFast != null && lastSlow != null && lastFast < lastSlow;
    const trendDir = trendBull ? 1 : trendBear ? -1 : 0;

    // 2. ATR (Wilder) en entrada
    const entryCloses = entryBars.map(b => b.c);
    const entryHighs = entryBars.map(b => b.h);
    const entryLows = entryBars.map(b => b.l);
    let atr = Ind.lastFinite(Ind.atr(entryHighs, entryLows, entryCloses, modeConfig.atrPeriod));
    if (!Number.isFinite(atr) || atr <= 0) atr = currentPrice * 0.001;

    // 3. Estructura (BOS / CHoCH)
    const pivots = Str.pivots(entryBars, CONFIG.smc.swingLookback);
    const structure = Str.detectBOS(entryBars, pivots) || Str.detectCHoCH(entryBars, pivots);
    const structureDir = structure ? structure.direction : 0;
    const structureAligned = !!(structure && trendDir !== 0 && structureDir === trendDir);

    // 4. Zonas institucionales a favor de tendencia
    const zonesInTrend = trendDir !== 0
      ? [...Zn.fvg(entryBars, atr), ...Zn.orderBlocks(entryBars, atr, trendDir)].filter(z => z.direction === trendDir)
      : [];
    const activeZone = Zn.activeZone(zonesInTrend, currentPrice);
    const activeOb = activeZone && activeZone.type === 'OB' ? activeZone : null;
    const activeFvg = activeZone && activeZone.type === 'FVG' ? activeZone : null;
    const zoneTouched = !!(activeZone && activeZone.distance <= atr * 0.1);

    // 5. Momentum (RSI)
    const rsi = Ind.lastFinite(Ind.rsi(entryCloses, modeConfig.rsiPeriod));
    const momentumValid = rsi != null && (
      (trendBull && rsi > 50 && rsi < 75) || (trendBear && rsi < 50 && rsi > 25)
    );

    // 6. Checklist
    const checklist = {
      trend: { valid: trendBull || trendBear,
        reason: trendBull ? 'EMA50 > EMA200 (alcista)' : trendBear ? 'EMA50 < EMA200 (bajista)' : 'Tendencia no definida' },
      structure: { valid: structureAligned,
        reason: structure ? (structure.type + (structureDir === 1 ? ' alcista' : ' bajista') + (structureAligned ? ' alineado' : ' en contra')) : 'Sin BOS/CHoCH alineado' },
      zone: { valid: !!activeZone,
        reason: activeOb ? 'Order Block activo' : activeFvg ? 'Fair Value Gap activo' : 'Sin zona institucional' },
      momentum: { valid: momentumValid, reason: rsi != null ? 'RSI ' + rsi.toFixed(1) : 'RSI no disponible' }
    };
    const validCount = Object.values(checklist).filter(c => c.valid).length;

    // 7. Estados
    const prox = CONFIG.alert.proxAtrMult * atr;
    const approaching = !!(activeZone && activeZone.distance > 0 && activeZone.distance < prox);
    const armed = CONFIG.alert.enabled && trendDir !== 0 && structureAligned && !!activeZone && approaching;
    const active = trendDir !== 0 && structureAligned && zoneTouched && momentumValid &&
      validCount >= modeConfig.minConfluences;

    let direction = null, entry = null, stop = null, target = null, riskReward = null;
    if (active) {
      direction = trendDir === 1 ? 'buy' : 'sell';
      entry = currentPrice;
      if (direction === 'buy') { stop = entry - atr * modeConfig.slAtrMult; target = entry + atr * modeConfig.tpAtrMult; }
      else { stop = entry + atr * modeConfig.slAtrMult; target = entry - atr * modeConfig.tpAtrMult; }
      riskReward = Math.abs(target - entry) / Math.abs(stop - entry);
    }

    const confidence = validCount === 4 ? 'alta' : validCount === 3 ? 'media' : validCount === 2 ? 'baja' : 'nula';

    return {
      state: active ? 'active' : armed ? 'armed' : 'waiting',
      active, armed: active ? false : armed,
      direction,
      armedDirection: armed ? (trendDir === 1 ? 'buy' : 'sell') : null,
      confidence, entry, stop, target, riskReward,
      armedZone: armed ? activeZone : null,
      armedDistance: activeZone ? activeZone.distance : null,
      checklist,
      reasons: Object.values(checklist).filter(c => c.valid).map(c => c.reason),
      zones: { ob: activeOb, fvg: activeFvg }
    };
  }

  return { evaluate };
})();
