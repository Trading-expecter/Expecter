/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * zones.js  (5/11)  ·  Zonas institucionales (Order Block / FVG)
 * ============================================================ */
window.Zones = (function () {
  'use strict';

  const smc = () => CONFIG.smc;

  // ¿Alguna vela posterior atravesó entera la zona [bottom, top]?
  function isMitigated(bars, zoneIndex, direction, top, bottom) {
    for (let i = zoneIndex + 1; i < bars.length; i++) {
      const b = bars[i];
      if (direction > 0 && b.l <= bottom) return true;
      if (direction < 0 && b.h >= top) return true;
    }
    return false;
  }

  function fvg(bars, atrValue) {
    const out = [];
    if (!bars || bars.length < 3) return out;
    const minGap = (Number.isFinite(atrValue) && atrValue > 0)
      ? atrValue * smc().fvgMinAtrMult : 0;
    const lastClosedIdx = bars.length > 1 ? bars.length - 2 : bars.length - 1;

    for (let i = 2; i <= lastClosedIdx; i++) {
      const a = bars[i - 2], c = bars[i];
      if (c.l > a.h && (c.l - a.h) > minGap) {
        const zone = { type: 'FVG', direction: 1, top: c.l, bottom: a.h, index: i, fresh: true };
        zone.fresh = !isMitigated(bars, i, 1, zone.top, zone.bottom);
        out.push(zone);
      }
      if (c.h < a.l && (a.l - c.h) > minGap) {
        const zone = { type: 'FVG', direction: -1, top: a.l, bottom: c.h, index: i, fresh: true };
        zone.fresh = !isMitigated(bars, i, -1, zone.top, zone.bottom);
        out.push(zone);
      }
    }
    return out;
  }

  function orderBlocks(bars, atrValue, direction) {
    const out = [];
    if (!bars || bars.length < 2) return out;
    const maxAge = smc().obMaxAgeBars;
    const lastClosedIdx = bars.length > 1 ? bars.length - 2 : bars.length - 1;

    for (let i = 1; i < lastClosedIdx; i++) {
      const b = bars[i], next = bars[i + 1];
      if (direction > 0 && b.c < b.o && next.c > next.o && next.c > b.h) {
        const zone = { type: 'OB', direction: 1, top: b.h, bottom: b.l, index: i, fresh: true };
        zone.fresh = (lastClosedIdx - i) < maxAge && !isMitigated(bars, i, 1, zone.top, zone.bottom);
        out.push(zone);
      }
      if (direction < 0 && b.c > b.o && next.c < next.o && next.c < b.l) {
        const zone = { type: 'OB', direction: -1, top: b.h, bottom: b.l, index: i, fresh: true };
        zone.fresh = (lastClosedIdx - i) < maxAge && !isMitigated(bars, i, -1, zone.top, zone.bottom);
        out.push(zone);
      }
    }
    return out;
  }

  function activeZone(zones, price) {
    if (!zones || !zones.length || !Number.isFinite(price)) return null;
    const valid = zones.filter(z => z.fresh);
    if (!valid.length) return null;
    for (const z of valid) {
      if (price > z.top) z.distance = price - z.top;
      else if (price < z.bottom) z.distance = z.bottom - price;
      else z.distance = 0;
      z.mid = (z.top + z.bottom) / 2;
    }
    valid.sort((a, b) => a.distance - b.distance);
    return valid[0];
  }

  return { fvg, orderBlocks, activeZone };
})();
