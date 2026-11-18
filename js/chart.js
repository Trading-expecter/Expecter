/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * chart.js  (7/11)  ·  Gráfico de velas (canvas 2D)
 * ============================================================ */
window.Chart = (function () {
  'use strict';

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let bars = [], ema50 = [], ema200 = [];
    let zones = { ob: null, fvg: null };
    let signal = null;
    let digits = 2;
    let count = CONFIG.chart.defaultCount;
    let hoverIndex = null;
    let legendCb = null;
    const C = CONFIG.chart.colors;

    const fmt = p => Number.isFinite(p) ? p.toFixed(digits) : '—';

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 10, padR = 70, padT = 15, padB = 25;
      const plotW = w - padL - padR, plotH = h - padT - padB;
      if (plotW <= 0 || plotH <= 0 || !bars.length) return;

      const n = bars.length;
      const cnt = Math.min(count, n);
      const end = n, start = Math.max(0, end - cnt);

      let lo = Infinity, hi = -Infinity;
      for (let i = start; i < end; i++) { lo = Math.min(lo, bars[i].l); hi = Math.max(hi, bars[i].h); }
      if (signal) [signal.entry, signal.stop, signal.target].forEach(p => {
        if (Number.isFinite(p)) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
      });
      if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;

      const y = p => padT + (hi - p) / (hi - lo) * plotH;
      const step = plotW / cnt;
      const x = i => padL + (i - start) * step + step / 2;

      function drawZone(z, fill, stroke) {
        if (!z) return;
        const yt = y(z.top), yb = y(z.bottom);
        ctx.fillStyle = fill;
        ctx.fillRect(padL, yt, plotW, Math.max(1, yb - yt));
        ctx.strokeStyle = stroke; ctx.lineWidth = 1;
        ctx.strokeRect(padL + 0.5, yt + 0.5, plotW - 1, Math.max(1, yb - yt) - 1);
      }
      drawZone(zones.ob, C.ob, C.obStroke);
      drawZone(zones.fvg, C.fvg, C.fvgStroke);
      if (signal && signal.armed && signal.armedZone) {
        drawZone(signal.armedZone, 'rgba(255,184,0,0.12)', 'rgba(255,184,0,0.55)');
      }

      ctx.strokeStyle = C.grid; ctx.fillStyle = C.axisText;
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let k = 0; k <= 4; k++) {
        const p = lo + (hi - lo) * k / 4, yy = Math.round(y(p)) + 0.5;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.fillText(fmt(p), padL + plotW + 6, yy);
      }

      const bodyW = Math.max(1, Math.min(step * 0.6, 14));
      for (let i = start; i < end; i++) {
        const b = bars[i], xx = x(i), up = b.c >= b.o;
        const isLive = b.live && i === end - 1;
        ctx.globalAlpha = isLive ? 0.55 : 1;
        ctx.strokeStyle = up ? C.wickUp : C.wickDown; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, y(b.h)); ctx.lineTo(Math.round(xx) + 0.5, y(b.l)); ctx.stroke();
        ctx.fillStyle = up ? C.up : C.down;
        ctx.fillRect(xx - bodyW / 2, y(Math.max(b.o, b.c)), bodyW, Math.max(1, y(Math.min(b.o, b.c)) - y(Math.max(b.o, b.c))));
      }
      ctx.globalAlpha = 1;

      function drawEMA(arr, color) {
        if (!arr || !arr.length) return;
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
        let started = false;
        for (let i = start; i < end; i++) {
          const v = arr[i]; if (v == null || !Number.isFinite(v)) continue;
          const xx = x(i), yy = y(v);
          if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
      drawEMA(ema50, C.ema50); drawEMA(ema200, C.ema200);

      if (signal && signal.active && Number.isFinite(signal.entry)) {
        const col = signal.direction === 'buy' ? C.up : C.down;
        function levelLine(p, color, label) {
          const yy = y(p);
          ctx.strokeStyle = color; ctx.globalAlpha = 0.6; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
          ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(label, padL + plotW - 4, yy);
        }
        levelLine(signal.entry, col, 'E');
        levelLine(signal.stop, C.down, 'SL');
        levelLine(signal.target, C.up, 'TP');
        ctx.fillStyle = col; ctx.beginPath();
        const sx = x(end - 1);
        if (signal.direction === 'buy') { ctx.moveTo(sx, y(signal.entry) - 8); ctx.lineTo(sx - 6, y(signal.entry) - 18); ctx.lineTo(sx + 6, y(signal.entry) - 18); }
        else { ctx.moveTo(sx, y(signal.entry) + 8); ctx.lineTo(sx - 6, y(signal.entry) + 18); ctx.lineTo(sx + 6, y(signal.entry) + 18); }
        ctx.closePath(); ctx.fill();
      }

      if (hoverIndex != null && hoverIndex >= start && hoverIndex < end) {
        const b = bars[hoverIndex], xx = Math.round(x(hoverIndex)) + 0.5, yy = Math.round(y(b.c)) + 0.5;
        ctx.strokeStyle = C.crosshair; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + plotH); ctx.moveTo(padL, yy); ctx.lineTo(padL + plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.axisText; ctx.textAlign = 'left'; ctx.fillText(fmt(b.c), padL + plotW + 6, yy);
      }
    }

    function setHover(idx) { hoverIndex = idx; draw(); if (legendCb) legendCb(idx != null ? bars[idx] : null); }

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const cc = CONFIG.chart;
      count = Math.max(cc.minCount, Math.min(cc.maxCount, Math.round(count * (e.deltaY > 0 ? 1.1 : 0.9))));
      draw();
    }, { passive: false });

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left;
      const padL = 10, padR = 70, plotW = canvas.clientWidth - padL - padR;
      if (!bars.length || mx < padL || mx > padL + plotW) { setHover(null); return; }
      const n = bars.length, cnt = Math.min(count, n), start = Math.max(0, n - cnt), step = plotW / cnt;
      const idx = start + Math.floor((mx - padL) / step);
      setHover(idx >= start && idx < n ? idx : null);
    });
    canvas.addEventListener('mouseleave', () => setHover(null));

    return {
      setData(newBars, e50, e200) { bars = newBars || []; ema50 = e50 || []; ema200 = e200 || []; draw(); },
      setZones(z) { zones = z || { ob: null, fvg: null }; draw(); },
      setSignal(s) { signal = s; draw(); },
      setDigits(d) { digits = Number.isFinite(d) ? d : 2; draw(); },
      reset() { count = CONFIG.chart.defaultCount; draw(); },
      onHover(cb) { legendCb = cb; },
      resize: draw
    };
  }

  return { create };
})();
