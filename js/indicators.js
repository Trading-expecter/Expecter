(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AT = root.AT || {}; root.AT.indicators = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nulls(n) { return new Array(n).fill(null); }

  function firstValid(values, from) {
    const start = from || 0;
    for (let i = start; i < values.length; i++) {
      const v = values[i];
      if (v != null && Number.isFinite(v)) return i;
    }
    return -1;
  }

  function last(values, k) { return values[values.length - 1 - (k || 0)]; }

  function seedSum(values, start, period) {
    let sum = 0;
    for (let i = start; i < start + period; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) return null;
      sum += v;
    }
    return sum;
  }

  function sma(values, period) {
    const n = values.length;
    const out = nulls(n);
    if (period <= 0 || n < period) return out;

    let start = firstValid(values);
    while (start >= 0 && start + period <= n) {
      const sum = seedSum(values, start, period);
      if (sum != null) {
        out[start + period - 1] = sum / period;
        for (let i = start + period; i < n; i++) {
          const cur = values[i];
          const drop = values[i - period];
          if (cur == null || !Number.isFinite(cur) || drop == null || !Number.isFinite(drop)) {
            out[i] = null;
            continue;
          }
          const prev = out[i - 1];
          if (prev == null) {
            const winSum = seedSum(values, i - period + 1, period);
            out[i] = winSum != null ? winSum / period : null;
          } else {
            out[i] = prev + (cur - drop) / period;
          }
        }
        return out;
      }
      start = firstValid(values, start + 1);
    }
    return out;
  }

  function smooth(values, period, alpha) {
    const n = values.length;
    const out = nulls(n);
    if (period <= 0 || alpha <= 0 || alpha > 1 || n < period) return out;

    let start = firstValid(values);
    while (start >= 0 && start + period <= n) {
      const sum = seedSum(values, start, period);
      if (sum != null) {
        let prev = sum / period;
        out[start + period - 1] = prev;
        for (let i = start + period; i < n; i++) {
          const v = values[i];
          if (v == null || !Number.isFinite(v)) { out[i] = null; continue; }
          prev = alpha * v + (1 - alpha) * prev;
          out[i] = prev;
        }
        return out;
      }
      start = firstValid(values, start + 1);
    }
    return out;
  }

  function ema(values, period) { return smooth(values, period, 2 / (period + 1)); }
  function rma(values, period) { return smooth(values, period, 1 / period); }

  function updateEma(previous, value, period) {
    if (previous == null || !Number.isFinite(previous)) return value;
    if (value == null || !Number.isFinite(value)) return previous;
    const k = 2 / (period + 1);
    return value * k + previous * (1 - k);
  }

  function updateRma(previous, value, period) {
    if (previous == null || !Number.isFinite(previous)) return value;
    if (value == null || !Number.isFinite(value)) return previous;
    return (previous * (period - 1) + value) / period;
  }

  function tr(highs, lows, closes) {
    const n = closes.length;
    const out = new Array(n);
    if (n === 0) return out;
    out[0] = highs[0] - lows[0];
    for (let i = 1; i < n; i++) {
      out[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }
    return out;
  }

  function atr(highs, lows, closes, period) {
    return rma(tr(highs, lows, closes), period || 14);
  }

  function rsi(closes, period) {
    period = period || 14;
    const n = closes.length;
    const out = nulls(n);
    if (n <= period) return out;

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change >= 0) gains += change;
      else losses -= change;
    }
    gains /= period;
    losses /= period;

    function value(g, l) {
      if (l === 0) return g === 0 ? 50 : 100;
      return 100 - 100 / (1 + g / l);
    }

    out[period] = value(gains, losses);

    for (let i = period + 1; i < n; i++) {
      const change = closes[i] - closes[i - 1];
      gains = (gains * (period - 1) + (change > 0 ? change : 0)) / period;
      losses = (losses * (period - 1) + (change < 0 ? -change : 0)) / period;
      out[i] = value(gains, losses);
    }
    return out;
  }

  function adx(highs, lows, closes, period) {
    period = period || 14;
    const n = closes.length;
    const plusDM = nulls(n);
    const minusDM = nulls(n);
    const trueRange = nulls(n);

    for (let i = 1; i < n; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      plusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
      minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
      trueRange[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }

    const smoothedPlus = rma(plusDM, period);
    const smoothedMinus = rma(minusDM, period);
    const smoothedTr = rma(trueRange, period);

    const plusDI = nulls(n);
    const minusDI = nulls(n);
    const dx = nulls(n);

    for (let i = 0; i < n; i++) {
      const sp = smoothedPlus[i];
      const sm = smoothedMinus[i];
      const st = smoothedTr[i];
      if (sp == null || sm == null || st == null) continue;
      if (!Number.isFinite(sp) || !Number.isFinite(sm) || !Number.isFinite(st)) continue;
      plusDI[i] = st === 0 ? 0 : (100 * sp) / st;
      minusDI[i] = st === 0 ? 0 : (100 * sm) / st;
      const sum = plusDI[i] + minusDI[i];
      dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
    }

    return {
      adx: rma(dx, period),
      plusDI: plusDI,
      minusDI: minusDI,
      dx: dx
    };
  }

  function vwap(bars, resetHourUtc) {
    const n = bars.length;
    const out = nulls(n);
    if (!n) return out;
    const resetHour = resetHourUtc != null ? resetHourUtc : 0;

    let cumPV = 0;
    let cumV = 0;
    let currentSession = null;

    for (let i = 0; i < n; i++) {
      const b = bars[i];
      const d = new Date(b.t);
      const sessionKey = Math.floor((b.t - resetHour * 3600000) / 86400000);

      if (sessionKey !== currentSession) {
        cumPV = 0;
        cumV = 0;
        currentSession = sessionKey;
      }

      const tp = (b.h + b.l + b.c) / 3;
      const vol = Number.isFinite(b.v) && b.v > 0 ? b.v : 0;
      cumPV += tp * vol;
      cumV += vol;
      out[i] = cumV > 0 ? cumPV / cumV : null;
    }
    return out;
  }

  return {
    nulls: nulls,
    firstValid: firstValid,
    last: last,
    sma: sma,
    ema: ema,
    rma: rma,
    updateEma: updateEma,
    updateRma: updateRma,
    tr: tr,
    atr: atr,
    rsi: rsi,
    adx: adx,
    vwap: vwap
  };
}));