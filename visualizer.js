/* Menggambar zona file + commit graph dari state GitEngine. */
(function (global) {
  'use strict';

  const COLORS = ['#4f8cff', '#ff7a59', '#2fbf71', '#a56bff', '#f5b301', '#ef5da8'];
  const DX = 96;
  const DY = 104;
  const R = 22;
  const PAD_X = 50;
  const PAD_Y = 52;
  const NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function layout(commits) {
    const pos = {};
    const laneTaken = {};
    let lanes = 0;
    commits.forEach((c) => {
      const depth = c.parents.length ? Math.max.apply(null, c.parents.map((p) => pos[p].depth)) + 1 : 0;
      let lane = -1;
      if (c.parents.length) {
        const pl = pos[c.parents[0]].lane;
        if (!laneTaken[c.parents[0]]) {
          lane = pl;
          laneTaken[c.parents[0]] = true;
        }
      }
      if (lane < 0) lane = lanes++;
      pos[c.id] = { depth: depth, lane: lane };
    });
    return { pos: pos, lanes: Math.max(lanes, 1) };
  }

  class Visualizer {
    constructor(engine, refs) {
      this.e = engine;
      this.r = refs;
      this.seen = {};
    }

    render() {
      this.renderZones();
      this.renderGraph();
    }

    chips(box, items, empty) {
      box.textContent = '';
      if (!items.length) {
        const p = document.createElement('span');
        p.className = 'empty';
        p.textContent = empty;
        box.appendChild(p);
        return;
      }
      items.forEach((it) => {
        const c = document.createElement('span');
        c.className = 'chip ' + it.cls;
        c.textContent = it.text;
        box.appendChild(c);
      });
    }

    renderZones() {
      const s = this.e.s;
      const ch = this.e.changes();
      const hf = this.e.commitFiles(this.e.headId());
      const state = {};
      ch.untracked.forEach((n) => (state[n] = 'untracked'));
      ch.unstaged.forEach(([n]) => (state[n] = 'modified'));

      const work = Object.keys(s.work)
        .sort()
        .map((n) => ({ text: n + ' · v' + s.work[n], cls: state[n] || 'clean' }));
      const staged = ch.staged.map(([n, k]) => ({
        text: (k === 'deleted' ? '− ' : '+ ') + n + (k === 'deleted' ? '' : ' · v' + s.index[n]),
        cls: k === 'deleted' ? 'deleted' : 'staged',
      }));
      const repo = Object.keys(hf)
        .sort()
        .map((n) => ({ text: n + ' · v' + hf[n], cls: 'clean' }));

      this.chips(this.r.work, work, 'kosong — coba: touch index.html');
      this.chips(this.r.stage, staged, 'kosong — coba: git add .');
      this.chips(this.r.repo, repo, s.inited ? 'belum ada commit' : 'belum git init');
      const id = this.e.headId();
      this.r.repoTitle.textContent = id ? 'commit ' + id : '';
    }

    renderGraph() {
      const s = this.e.s;
      const headId = this.e.headId();
      this.drawGraph({
        svg: this.r.svg,
        empty: this.r.empty,
        scroll: this.r.scroll,
        seenKey: 'local',
        commits: this.e.reachable(),
        labels: (c) => {
          const pills = [];
          Object.keys(s.branches)
            .filter((b) => s.branches[b] === c.id)
            .sort()
            .forEach((b) => pills.push({ t: s.head.branch === b ? 'HEAD ➜ ' + b : b, head: s.head.branch === b }));
          if (!s.head.branch && headId === c.id) pills.push({ t: 'HEAD', head: true });
          Object.keys(s.tracking)
            .filter((b) => s.tracking[b] === c.id)
            .sort()
            .forEach((b) => pills.push({ t: b, remote: true }));
          return pills;
        },
        headId: headId,
      });
      const hub = s.hub.branches;
      this.r.remoteUrl.textContent = s.remoteUrl ? 'origin = ' + s.remoteUrl : 'belum terhubung — coba: git remote add origin https://github.com/kamu/proyek.git';
      this.drawGraph({
        svg: this.r.hubSvg,
        empty: this.r.hubEmpty,
        scroll: this.r.hubScroll,
        seenKey: 'hub',
        commits: this.e.hubReachable(),
        labels: (c) =>
          Object.keys(hub)
            .filter((b) => hub[b] === c.id)
            .sort()
            .map((b) => ({ t: b, head: true })),
        headId: null,
      });
    }

    drawGraph(o) {
      const svg = o.svg;
      const commits = o.commits;
      svg.textContent = '';
      if (!commits.length) {
        svg.setAttribute('width', 10);
        svg.setAttribute('height', 10);
        o.empty.hidden = false;
        this.seen[o.seenKey] = new Set();
        return;
      }
      o.empty.hidden = true;
      const seen = this.seen[o.seenKey] || new Set();
      const { pos, lanes } = layout(commits);
      const maxDepth = Math.max.apply(null, commits.map((c) => pos[c.id].depth));
      const W = PAD_X * 2 + maxDepth * DX;
      const H = PAD_Y * 2 + (lanes - 1) * DY + 36;
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      const xy = (id) => ({ x: PAD_X + pos[id].depth * DX, y: PAD_Y + pos[id].lane * DY });

      const edges = el('g');
      commits.forEach((c) => {
        const to = xy(c.id);
        c.parents.forEach((p, i) => {
          const from = xy(p);
          const mx = (from.x + to.x) / 2;
          const color = COLORS[pos[i === 0 ? c.id : p].lane % COLORS.length];
          edges.appendChild(el('path', { d: 'M' + from.x + ' ' + from.y + ' C' + mx + ' ' + from.y + ' ' + mx + ' ' + to.y + ' ' + to.x + ' ' + to.y, class: 'edge', stroke: color }));
        });
      });
      svg.appendChild(edges);

      const nowSeen = new Set();
      commits.forEach((c) => {
        const { x, y } = xy(c.id);
        const color = COLORS[pos[c.id].lane % COLORS.length];
        const g = el('g', { class: 'node' + (seen.has(c.id) ? '' : ' pop') });
        nowSeen.add(c.id);
        g.appendChild(el('circle', { cx: x, cy: y, r: R, fill: color, class: c.id === o.headId ? 'head' : '' }));
        g.appendChild(el('text', { x: x, y: y + 3, class: 'cid' }, c.id));
        const msg = c.msg.length > 14 ? c.msg.slice(0, 13) + '…' : c.msg;
        g.appendChild(el('text', { x: x, y: y - R - 9, class: 'cmsg' }, msg));
        o.labels(c).forEach((p, i) => {
          const w = p.t.length * 7.2 + 16;
          const py = y + R + 10 + i * 24;
          g.appendChild(el('rect', { x: x - w / 2, y: py, width: w, height: 20, rx: 10, fill: p.head ? color : 'var(--card)', stroke: color, class: 'pill' + (p.remote ? ' remote' : '') }));
          g.appendChild(el('text', { x: x, y: py + 14, class: 'ptxt' + (p.head ? ' on' : '') }, p.t));
        });
        svg.appendChild(g);
      });
      this.seen[o.seenKey] = nowSeen;
      o.scroll.scrollLeft = o.scroll.scrollWidth;
    }
  }

  global.Visualizer = Visualizer;
})(window);
