/* Panel yang bisa diubah ukurannya lewat gutter (seret / keyboard / dobel klik untuk reset). */
(function () {
  'use strict';

  const KEY = 'git-visualizer-layout';
  const root = document.documentElement;
  const gutters = Array.from(document.querySelectorAll('.gutter'));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function save(obj) {
    try {
      localStorage.setItem(KEY, JSON.stringify(obj));
    } catch (e) {
      /* tanpa penyimpanan pun tetap jalan */
    }
  }
  let saved = load();
  Object.keys(saved).forEach((k) => root.style.setProperty(k, saved[k]));

  function vars(g) {
    return [g.dataset.var, g.dataset.var2].filter(Boolean);
  }
  function size(el, axis) {
    const r = el.getBoundingClientRect();
    return axis === 'x' ? r.width : r.height;
  }
  function limits(g, axis, other) {
    const min = parseFloat(g.dataset.min || 80);
    const viewMax = (axis === 'x' ? innerWidth : innerHeight) * 0.75;
    const max = g.dataset.max ? Math.min(parseFloat(g.dataset.max), viewMax) : viewMax;
    return { min: min, max: other === undefined ? max : other - min };
  }

  function apply(g, next, otherNext) {
    if (g.dataset.pair) {
      root.style.setProperty(g.dataset.var, next + 'fr');
      root.style.setProperty(g.dataset.var2, otherNext + 'fr');
    } else {
      root.style.setProperty(g.dataset.var, next + 'px');
    }
    saved = load();
    vars(g).forEach((v) => (saved[v] = root.style.getPropertyValue(v)));
    save(saved);
  }

  // dipakai drag dan keyboard: ubah ukuran dari ukuran awal sebesar delta piksel
  function resize(g, startSize, startOther, delta) {
    const axis = g.dataset.axis;
    const dir = parseFloat(g.dataset.dir || 1);
    if (g.dataset.pair) {
      const total = startSize + startOther;
      const lim = limits(g, axis, total);
      const next = clamp(startSize + dir * delta, lim.min, lim.max);
      apply(g, Math.round(next), Math.round(total - next));
    } else {
      const lim = limits(g, axis);
      apply(g, Math.round(clamp(startSize + dir * delta, lim.min, lim.max)));
    }
  }

  function measure(g) {
    const axis = g.dataset.axis;
    const target = document.querySelector(g.dataset.target);
    const pair = g.dataset.pair ? document.querySelector(g.dataset.pair) : null;
    return { start: size(target, axis), other: pair ? size(pair, axis) : 0 };
  }

  gutters.forEach((g) => {
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const axis = g.dataset.axis;
      const m = measure(g);
      const origin = axis === 'x' ? e.clientX : e.clientY;
      g.setPointerCapture(e.pointerId);
      g.classList.add('drag');
      document.body.classList.add('resizing', axis === 'x' ? 'rx' : 'ry');
      const move = (ev) => resize(g, m.start, m.other, (axis === 'x' ? ev.clientX : ev.clientY) - origin);
      const up = () => {
        g.classList.remove('drag');
        document.body.classList.remove('resizing', 'rx', 'ry');
        g.removeEventListener('pointermove', move);
        g.removeEventListener('pointerup', up);
        g.removeEventListener('pointercancel', up);
      };
      g.addEventListener('pointermove', move);
      g.addEventListener('pointerup', up);
      g.addEventListener('pointercancel', up);
    });

    g.addEventListener('keydown', (e) => {
      const axis = g.dataset.axis;
      const keys = axis === 'x' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      const m = measure(g);
      resize(g, m.start, m.other, keys[e.key] * (e.shiftKey ? 80 : 24));
    });

    g.addEventListener('dblclick', () => {
      saved = load();
      vars(g).forEach((v) => {
        root.style.removeProperty(v);
        delete saved[v];
      });
      save(saved);
    });
  });

  const reset = document.getElementById('btn-layout');
  if (reset) {
    reset.addEventListener('click', () => {
      Object.keys(load()).forEach((k) => root.style.removeProperty(k));
      save({});
    });
  }
})();
