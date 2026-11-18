window.Chart = (function () {
  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let bars = [];
    let ema50 = [];
    let ema200 = [];
    let zones = { ob: null, fvg: null };
    let signal = null;
    let count = CONFIG.chart.defaultCount;
    let offset = 0;
    let hoverIndex = null;

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const padL = 10, padR = 65, padT = 15, padB = 25;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      if (plotW <= 0 || plotH <= 0 || !bars.length) return;

      const n = bars.length;
      const cnt = Math.min(count, n);
      const end = Math.min(n, Math.max(cnt, n - offset));
      const start = end - cnt;

      let lo = Infinity, hi = -Infinity;
      for (let i = start; i < end; i++) {
        if (bars[i].l < lo) lo = bars[i].l;
        if (bars[i].h > hi) hi = bars[i].h;
      }
      if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.1;
      lo -= pad;
      hi += pad;

      const y = p => padT + (hi - p) / (hi - lo) * plotH;
      const step = plotW / cnt;
      const x = i => padL + (i - start) * step + step / 2;

      if (zones.ob) {
        ctx.fillStyle = CONFIG.chart.colors.ob;
        ctx.fillRect(padL, y(zones.ob.top), plotW, y(zones.ob.bottom) - y(zones.ob.top));
        ctx.strokeStyle = 'rgba(0,212,170,0.45)';
        ctx.strokeRect(padL + 0.5, y(zones.ob.top) + 0.5, plotW - 1, y(zones.ob.bottom) - y(zones.ob.top) - 1);
      }
      if (zones.fvg) {
        ctx.fillStyle = CONFIG.chart.colors.fvg;
        ctx.fillRect(padL, y(zones.fvg.top), plotW, y(zones.fvg.bottom) - y(zones.fvg.top));
        ctx.strokeStyle = 'rgba(88,166,255,0.45)';
        ctx.strokeRect(padL + 0.5, y(zones.fvg.top) + 0.5, plotW - 1, y(zones.fvg.bottom) - y(zones.fvg.top) - 1);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.fillStyle = '#828282';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      for (let k = 0; k <= 4; k++) {
        const p = lo + (hi - lo) * k / 4;
        const yy = Math.round(y(p)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(padL + plotW, yy);
        ctx.stroke();
        ctx.fillText(p.toFixed(2), padL + plotW + 6, yy + 3);
      }

      for (let i = start; i < end; i++) {
        const b = bars[i];
        const xx = Math.round(x(i)) + 0.5;
        const isLive = b.live && i === end - 1;
        ctx.globalAlpha = isLive ? 0.55 : 1;
        ctx.strokeStyle = b.c >= b.o ? CONFIG.chart.colors.up : CONFIG.chart.colors.down;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xx, y(b.h));
        ctx.lineTo(xx, y(b.l));
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        const top = y(Math.max(b.o, b.c));
        const bot = y(Math.min(b.o, b.c));
        ctx.fillRect(Math.round(x(i) - step * 0.3), top, Math.max(1, step * 0.6), Math.max(1, bot - top));
        ctx.globalAlpha = 1;
      }

      function drawEMA(arr, color) {
        if (!arr || !arr.length) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (let i = start; i < end; i++) {
          const v = arr[i];
          if (v == null || !Number.isFinite(v)) continue;
          const xx = x(i), yy = y(v);
          if (!started) { ctx.moveTo(xx, yy); started = true; }
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
      drawEMA(ema50, CONFIG.chart.colors.ema50);
      drawEMA(ema200, CONFIG.chart.colors.ema200);

      if (signal && signal.entry) {
        const idx = Math.min(end - 1, n - 1);
        const sx = x(idx);
        ctx.fillStyle = signal.direction === 'buy' ? CONFIG.chart.colors.up : CONFIG.chart.colors.down;
        ctx.beginPath();
        if (signal.direction === 'buy') {
          ctx.moveTo(sx, y(signal.entry) - 8);
          ctx.lineTo(sx - 6, y(signal.entry) - 18);
          ctx.lineTo(sx + 6, y(signal.entry) - 18);
        } else {
          ctx.moveTo(sx, y(signal.entry) + 8);
          ctx.lineTo(sx - 6, y(signal.entry) + 18);
          ctx.lineTo(sx + 6, y(signal.entry) + 18);
        }
        ctx.closePath();
        ctx.fill();
      }

      if (hoverIndex != null && hoverIndex >= start && hoverIndex < end) {
        const xx = Math.round(x(hoverIndex)) + 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xx, padT);
        ctx.lineTo(xx, padT + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      count = Math.max(20, Math.min(500, Math.round(count * (e.deltaY > 0 ? 1.1 : 0.9))));
      draw();
    }, { passive: false });

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const padL = 10, padR = 65;
      const plotW = canvas.clientWidth - padL - padR;
      if (!bars.length || mx < padL || mx > padL + plotW) { setHover(null); return; }
      const n = bars.length;
      const cnt = Math.min(count, n);
      const end = Math.min(n, Math.max(cnt, n - offset));
      const start = end - cnt;
      const step = plotW / cnt;
      const idx = start + Math.floor((mx - padL) / step);
      setHover(idx >= start && idx < end ? idx : null);
    });

    canvas.addEventListener('mouseleave', () => setHover(null));

    let legendCb = null;
    function setHover(idx) {
      hoverIndex = idx;
      draw();
      if (legendCb) legendCb(idx != null ? bars[idx] : null);
    }

    return {
      setData(newBars, e50, e200) {
        bars = newBars || [];
        ema50 = e50 || [];
        ema200 = e200 || [];
        draw();
      },
      setZones(z) { zones = z || { ob: null, fvg: null }; draw(); },
      setSignal(s) { signal = s && s.active ? s : null; draw(); },
      reset() { count = CONFIG.chart.defaultCount; offset = 0; draw(); },
      onHover(cb) { legendCb = cb; },
      resize: draw
    };
  }

  return { create };
})();