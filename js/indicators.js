/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * indicators.js  (2/11)  ·  EMA / RSI / ATR (suavizado Wilder)
 * ============================================================ */
window.Indicators = (function () {
  'use strict';

  function nulls(n) { return new Array(n).fill(null); }

  function firstValid(arr) {
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v != null && Number.isFinite(v)) return i;
    }
    return -1;
  }

  function lastFinite(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (v != null && Number.isFinite(v)) return v;
    }
    return null;
  }

  function sma(values, period) {
    const n = values.length;
    const out = nulls(n);
    if (period <= 0 || n < period) return out;
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v != null && Number.isFinite(v)) { sum += v; count++; }
      if (i >= period) {
        const old = values[i - period];
        if (old != null && Number.isFinite(old)) { sum -= old; count--; }
      }
      if (i >= period - 1 && count === period) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const n = values.length;
    const out = nulls(n);
    if (period <= 0) return out;
    const start = firstValid(values);
    if (start < 0 || n - start < period) return out;
    const k = 2 / (period + 1);
    let seed = 0, seedCount = 0;
    for (let i = start; seedCount < period && i < n; i++) {
      const v = values[i];
      if (v != null && Number.isFinite(v)) { seed += v; seedCount++; }
    }
    if (seedCount < period) return out;
    let prev = seed / period;
    const seedEnd = start + period - 1;
    out[seedEnd] = prev;
    for (let i = seedEnd + 1; i < n; i++) {
      const v = values[i];
      if (v == null || !Number.isFinite(v)) { out[i] = prev; continue; }
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsi(closes, period) {
    const n = closes.length;
    const out = nulls(n);
    if (period <= 0 || n <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < n; i++) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * (period - 1) + (d > 0 ? d : 0)) / period;
      loss = (loss * (period - 1) + (d < 0 ? -d : 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function atr(highs, lows, closes, period) {
    const n = closes.length;
    const out = nulls(n);
    if (period <= 0 || n <= period) return out;
    const tr = new Array(n).fill(0);
    tr[0] = highs[0] - lows[0];
    for (let i = 1; i < n; i++) {
      tr[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    let prev = sum / period;
    out[period] = prev;
    for (let i = period + 1; i < n; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  }

  return { ema, rsi, atr, sma, lastFinite };
})();
