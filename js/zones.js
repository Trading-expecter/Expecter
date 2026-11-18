window.Zones = (function () {
  function fvg(bars, atr) {
    const out = [];
    const minGap = atr * CONFIG.smc.fvgMinAtrMult;
    const lastClosedIdx = bars.length > 1 ? bars.length - 2 : bars.length - 1;

    for (let i = 2; i <= lastClosedIdx; i++) {
      const a = bars[i - 2], c = bars[i];
      if (c.l > a.h && (c.l - a.h) > minGap) {
        out.push({ type: 'FVG', direction: 1, top: c.l, bottom: a.h, index: i, fresh: true });
      }
      if (c.h < a.l && (a.l - c.h) > minGap) {
        out.push({ type: 'FVG', direction: -1, top: a.l, bottom: c.h, index: i, fresh: true });
      }
    }

    const lastPrice = bars[bars.length - 1].c;
    out.forEach(z => {
      if (z.direction === 1 && lastPrice <= z.bottom) z.fresh = false;
      if (z.direction === -1 && lastPrice >= z.top) z.fresh = false;
    });

    return out;
  }

  function orderBlocks(bars, atr, direction) {
    const out = [];
    const n = bars.length;
    const maxAge = CONFIG.smc.obMaxAgeBars;
    const lastClosedIdx = n > 1 ? n - 2 : n - 1;

    for (let i = 1; i < lastClosedIdx; i++) {
      const b = bars[i], next = bars[i + 1];
      if (direction > 0 && b.c < b.o && next.c > next.o && next.c > b.h) {
        out.push({ type: 'OB', direction: 1, top: b.h, bottom: b.l, index: i, fresh: (lastClosedIdx - i) < maxAge });
      }
      if (direction < 0 && b.c > b.o && next.c < next.o && next.c < b.l) {
        out.push({ type: 'OB', direction: -1, top: b.h, bottom: b.l, index: i, fresh: (lastClosedIdx - i) < maxAge });
      }
    }

    return out;
  }

  function activeZone(zones, price) {
    const valid = zones.filter(z => z.fresh);
    if (!valid.length) return null;
    valid.sort((a, b) => {
      const da = Math.abs((a.top + a.bottom) / 2 - price);
      const db = Math.abs((b.top + b.bottom) / 2 - price);
      return da - db;
    });
    return valid[0];
  }

  return { fvg, orderBlocks, activeZone };
})();