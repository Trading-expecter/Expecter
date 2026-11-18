window.Structure = (function () {
  function pivots(bars, lookback) {
    const highs = [], lows = [];
    for (let i = lookback; i < bars.length - lookback; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (bars[i].h <= bars[i - j].h || bars[i].h <= bars[i + j].h) isHigh = false;
        if (bars[i].l >= bars[i - j].l || bars[i].l >= bars[i + j].l) isLow = false;
      }
      if (isHigh) highs.push({ index: i, price: bars[i].h });
      if (isLow) lows.push({ index: i, price: bars[i].l });
    }
    return { highs, lows };
  }

  function detectBOS(bars, pivots) {
    if (bars.length < 2) return null;
    const lastHigh = pivots.highs.length ? pivots.highs[pivots.highs.length - 1] : null;
    const lastLow = pivots.lows.length ? pivots.lows[pivots.lows.length - 1] : null;
    const lastClosed = bars.length > 1 ? bars[bars.length - 2] : bars[bars.length - 1];

    if (lastHigh && lastClosed.c > lastHigh.price) {
      return { type: 'BOS', direction: 1, level: lastHigh.price, index: lastHigh.index };
    }
    if (lastLow && lastClosed.c < lastLow.price) {
      return { type: 'BOS', direction: -1, level: lastLow.price, index: lastLow.index };
    }
    return null;
  }

  function detectCHoCH(bars, pivots) {
    if (bars.length < 3) return null;
    const lastHigh = pivots.highs.length ? pivots.highs[pivots.highs.length - 1] : null;
    const lastLow = pivots.lows.length ? pivots.lows[pivots.lows.length - 1] : null;
    const prevHigh = pivots.highs.length > 1 ? pivots.highs[pivots.highs.length - 2] : null;
    const prevLow = pivots.lows.length > 1 ? pivots.lows[pivots.lows.length - 2] : null;
    const lastClosed = bars.length > 1 ? bars[bars.length - 2] : bars[bars.length - 1];

    if (lastHigh && prevLow && lastHigh.price < prevHigh.price && lastClosed.c < prevLow.price) {
      return { type: 'CHoCH', direction: -1, level: prevLow.price, index: prevLow.index };
    }
    if (lastLow && prevHigh && lastLow.price > prevLow.price && lastClosed.c > prevHigh.price) {
      return { type: 'CHoCH', direction: 1, level: prevHigh.price, index: prevHigh.index };
    }
    return null;
  }

  return { pivots, detectBOS, detectCHoCH };
})();