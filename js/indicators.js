window.Indicators = (function () {
  function nulls(n) { return new Array(n).fill(null); }

  function firstValid(arr) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] != null && Number.isFinite(arr[i])) return i;
    }
    return -1;
  }

  function ema(values, period) {
    const n = values.length;
    const out = nulls(n);
    const start = firstValid(values);
    if (start < 0 || n - start < period) return out;
    const k = 2 / (period + 1);
    let prev = 0;
    for (let i = start; i < start + period; i++) prev += values[i];
    prev /= period;
    out[start + period - 1] = prev;
    for (let i = start + period; i < n; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  function rsi(closes, period) {
    const n = closes.length;
    const out = nulls(n);
    if (n <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    gain /= period;
    loss /= period;
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
    if (n <= period) return out;
    const tr = new Array(n);
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
    out[period] = sum / period;
    for (let i = period + 1; i < n; i++) {
      out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
    }
    return out;
  }

  return { ema, rsi, atr };
})();