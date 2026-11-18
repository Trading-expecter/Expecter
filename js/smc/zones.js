window.AT = window.AT || {};
window.AT.smc = window.AT.smc || {};

window.AT.smc.zones = (function () {
  'use strict';

  const DEFAULT_OB_ATR_MULT = 1.5;
  const DEFAULT_OB_MIDLINE_RATIO = 0.5;
  const DEFAULT_OB_MAX_ZONES = 3;
  const DEFAULT_OB_MAX_AGE_BARS = 150;
  const DEFAULT_FVG_MIN_ATR_MULT = 0.30;
  const DEFAULT_FVG_MIDDLE_BODY_ATR_MULT = 0.5;
  const DEFAULT_FVG_MAX_AGE = 60;
  const DEFAULT_FVG_MAX_ZONES = 3;
  const OB_STRENGTH_CEILING_ATR = 5;
  const FVG_STRENGTH_CEILING_ATR = 3;

  function cfg() {
    return (window.AT_CONFIG && window.AT_CONFIG.smc) || {};
  }

  function obMult() {
    return cfg().obAtrMult != null ? cfg().obAtrMult : DEFAULT_OB_ATR_MULT;
  }

  function obMidlineRatio() {
    return cfg().obMidlineRatio != null ? cfg().obMidlineRatio : DEFAULT_OB_MIDLINE_RATIO;
  }

  function obMaxZones() {
    return cfg().obMaxZones != null ? cfg().obMaxZones : DEFAULT_OB_MAX_ZONES;
  }

  function obMaxAgeBars() {
    return cfg().obMaxAgeBars != null ? cfg().obMaxAgeBars : DEFAULT_OB_MAX_AGE_BARS;
  }

  function fvgMinMult() {
    return cfg().fvgMinAtrMult != null ? cfg().fvgMinAtrMult : DEFAULT_FVG_MIN_ATR_MULT;
  }

  function fvgMiddleBodyAtrMult() {
    return cfg().fvgMiddleBodyAtrMult != null ? cfg().fvgMiddleBodyAtrMult : DEFAULT_FVG_MIDDLE_BODY_ATR_MULT;
  }

  function fvgMaxAge() {
    return cfg().fvgMaxAge != null ? cfg().fvgMaxAge : DEFAULT_FVG_MAX_AGE;
  }

  function fvgMaxZones() {
    return cfg().fvgMaxZones != null ? cfg().fvgMaxZones : DEFAULT_FVG_MAX_ZONES;
  }

  function resolveAtrArray(bars, atr) {
    const n = bars.length;
    if (atr == null) return null;

    if (typeof atr === 'number') {
      if (!Number.isFinite(atr) || atr <= 0) return null;
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = atr;
      return out;
    }

    if (!Array.isArray(atr) || !atr.length) return null;

    const out = new Array(n).fill(null);
    const offset = atr.length <= n ? n - atr.length : 0;
    let lastValid = null;

    for (let i = 0; i < n; i++) {
      const src = i >= offset ? atr[i - offset] : null;
      if (src != null && Number.isFinite(src) && src > 0) {
        out[i] = src;
        lastValid = src;
      } else if (lastValid != null) {
        out[i] = lastValid;
      }
    }

    let firstValid = null;
    for (let i = 0; i < n; i++) {
      if (out[i] != null) { firstValid = out[i]; break; }
    }
    if (firstValid != null) {
      for (let i = 0; i < n; i++) {
        if (out[i] == null) out[i] = firstValid;
        else break;
      }
    }

    return out;
  }

  function atrAt(atrArr, i) {
    if (!atrArr) return 0;
    const v = atrArr[i];
    return v != null && Number.isFinite(v) && v > 0 ? v : 0;
  }

  function analyzeMitigation(bars, zone, direction, fromIndex) {
    let touched = false;
    let mitigated = false;
    let firstTouchBar = null;
    let touchCount = 0;
    let mitigationBar = null;

    for (let j = fromIndex; j < bars.length; j++) {
      const b = bars[j];
      let isTouching = false;

      if (direction === 1) {
        if (b.l < zone.top && b.h > zone.bottom) isTouching = true;
        if (b.c < zone.bottom) {
          mitigated = true;
          mitigationBar = j;
          if (isTouching && firstTouchBar == null) { firstTouchBar = j; touchCount++; }
          break;
        }
      } else {
        if (b.h > zone.bottom && b.l < zone.top) isTouching = true;
        if (b.c > zone.top) {
          mitigated = true;
          mitigationBar = j;
          if (isTouching && firstTouchBar == null) { firstTouchBar = j; touchCount++; }
          break;
        }
      }

      if (isTouching) {
        touched = true;
        if (firstTouchBar == null) firstTouchBar = j;
        touchCount++;
      }
    }

    return {
      touched: touched,
      mitigated: mitigated,
      mitigationBar: mitigationBar,
      firstTouchBar: firstTouchBar,
      touchCount: touchCount
    };
  }

  function detectOrderBlocks(bars, atr, direction, opts) {
    opts = opts || {};
    const result = [];
    if (!bars || bars.length < 3) return result;

    const atrArr = resolveAtrArray(bars, atr);
    if (!atrArr) return result;

    const mult = opts.obAtrMult != null ? opts.obAtrMult : obMult();
    const maxAge = opts.maxAge != null ? opts.maxAge : obMaxAgeBars();
    const midlineRatio = opts.midlineRatio != null ? opts.midlineRatio : obMidlineRatio();
    const wantBoth = direction !== 1 && direction !== -1;
    const lastIdx = bars.length - 1;

    for (let i = 1; i < bars.length - 1; i++) {
      const candle = bars[i];
      const next = bars[i + 1];
      const a = atrAt(atrArr, i);
      if (!(a > 0)) continue;

      const displacement = Math.abs(next.c - next.o);
      if (displacement < mult * a) continue;

      const age = lastIdx - i;
      if (age > maxAge) continue;

      if (candle.c < candle.o && next.c > next.o && (wantBoth || direction === 1)) {
        const top = candle.o;
        const bottom = candle.c;
        const midline = top - (top - bottom) * midlineRatio;
        if (next.c < midline) continue;

        const zone = {
          index: i,
          top: top,
          bottom: bottom,
          direction: 1,
          type: 'Bullish_OB',
          createdAtr: a,
          displacementAtr: displacement / a,
          strength: Math.min(1, displacement / (OB_STRENGTH_CEILING_ATR * a)),
          ageBars: age
        };
        const mit = analyzeMitigation(bars, zone, 1, i + 1);
        zone.touched = mit.touched;
        zone.mitigated = mit.mitigated;
        zone.mitigationBar = mit.mitigationBar;
        zone.firstTouchBar = mit.firstTouchBar;
        zone.touchCount = mit.touchCount;
        if (!zone.mitigated) result.push(zone);
      }

      if (candle.c > candle.o && next.c < next.o && (wantBoth || direction === -1)) {
        const top = candle.c;
        const bottom = candle.o;
        const midline = bottom + (top - bottom) * midlineRatio;
        if (next.c > midline) continue;

        const zone = {
          index: i,
          top: top,
          bottom: bottom,
          direction: -1,
          type: 'Bearish_OB',
          createdAtr: a,
          displacementAtr: displacement / a,
          strength: Math.min(1, displacement / (OB_STRENGTH_CEILING_ATR * a)),
          ageBars: age
        };
        const mit = analyzeMitigation(bars, zone, -1, i + 1);
        zone.touched = mit.touched;
        zone.mitigated = mit.mitigated;
        zone.mitigationBar = mit.mitigationBar;
        zone.firstTouchBar = mit.firstTouchBar;
        zone.touchCount = mit.touchCount;
        if (!zone.mitigated) result.push(zone);
      }
    }

    result.sort(function (a, b) {
      if (b.index !== a.index) return b.index - a.index;
      return b.strength - a.strength;
    });

    const max = opts.maxZones != null ? opts.maxZones : obMaxZones();
    return result.slice(0, max);
  }

  function detectFVG(bars, atr, direction, opts) {
    opts = opts || {};
    const result = [];
    if (!bars || bars.length < 4) return result;

    const atrArr = resolveAtrArray(bars, atr);
    if (!atrArr) return result;

    const minMult = opts.fvgMinAtrMult != null ? opts.fvgMinAtrMult : fvgMinMult();
    const maxAge = opts.maxAge != null ? opts.maxAge : fvgMaxAge();
    const midBodyMult = opts.fvgMiddleBodyAtrMult != null ? opts.fvgMiddleBodyAtrMult : fvgMiddleBodyAtrMult();
    const wantBoth = direction !== 1 && direction !== -1;
    const lastIdx = bars.length - 1;

    for (let i = 2; i < bars.length; i++) {
      const c1 = bars[i - 2];
      const c2 = bars[i - 1];
      const c3 = bars[i];
      const a = atrAt(atrArr, i);
      if (!(a > 0)) continue;

      const age = lastIdx - i;
      if (age > maxAge) continue;

      const middleBody = Math.abs(c2.c - c2.o);
      if (middleBody < midBodyMult * a) continue;

      if (c3.l > c1.h && (wantBoth || direction === 1)) {
        const top = c3.l;
        const bottom = c1.h;
        const gap = top - bottom;
        if (gap >= minMult * a) {
          const zone = {
            index: i,
            top: top,
            bottom: bottom,
            direction: 1,
            type: 'Bullish_FVG',
            createdAtr: a,
            gapAtr: gap / a,
            middleBodyAtr: middleBody / a,
            strength: Math.min(1, gap / (FVG_STRENGTH_CEILING_ATR * a)),
            ageBars: age
          };
          const mit = analyzeMitigation(bars, zone, 1, i + 1);
          zone.touched = mit.touched;
          zone.mitigated = mit.mitigated;
          zone.mitigationBar = mit.mitigationBar;
          zone.firstTouchBar = mit.firstTouchBar;
          zone.touchCount = mit.touchCount;
          if (!zone.mitigated) result.push(zone);
        }
      }

      if (c3.h < c1.l && (wantBoth || direction === -1)) {
        const top = c1.l;
        const bottom = c3.h;
        const gap = top - bottom;
        if (gap >= minMult * a) {
          const zone = {
            index: i,
            top: top,
            bottom: bottom,
            direction: -1,
            type: 'Bearish_FVG',
            createdAtr: a,
            gapAtr: gap / a,
            middleBodyAtr: middleBody / a,
            strength: Math.min(1, gap / (FVG_STRENGTH_CEILING_ATR * a)),
            ageBars: age
          };
          const mit = analyzeMitigation(bars, zone, -1, i + 1);
          zone.touched = mit.touched;
          zone.mitigated = mit.mitigated;
          zone.mitigationBar = mit.mitigationBar;
          zone.firstTouchBar = mit.firstTouchBar;
          zone.touchCount = mit.touchCount;
          if (!zone.mitigated) result.push(zone);
        }
      }
    }

    result.sort(function (a, b) {
      if (b.index !== a.index) return b.index - a.index;
      return b.strength - a.strength;
    });

    const max = opts.maxZones != null ? opts.maxZones : fvgMaxZones();
    return result.slice(0, max);
  }

  function findActiveZone(zones, price, direction) {
    if (!zones || !zones.length) return null;
    if (!Number.isFinite(price)) return null;
    const filterDir = direction === 1 || direction === -1;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (!z || z.mitigated === true) continue;
      if (filterDir && z.direction !== direction) continue;
      if (price >= z.bottom && price <= z.top) return z;
    }
    return null;
  }

  return {
    detectOrderBlocks: detectOrderBlocks,
    detectFVG: detectFVG,
    findActiveZone: findActiveZone
  };
})();