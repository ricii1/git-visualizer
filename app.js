/* Terminal, misi belajar, dan penghubung engine + visualizer. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const engine = new GitEngine();
  const viz = new Visualizer(engine, {
    work: $('z-work'),
    stage: $('z-stage'),
    repo: $('z-repo'),
    repoTitle: $('z-repo-title'),
    svg: $('graph'),
    empty: $('graph-empty'),
    scroll: $('graph-scroll'),
    hubSvg: $('hub-graph'),
    hubEmpty: $('hub-empty'),
    hubScroll: $('hub-scroll'),
    remoteUrl: $('remote-url'),
  });

  const term = $('term');
  const input = $('cmd');
  let used = new Set();
  let history = [];
  let hIdx = 0;

  const HELP = [
    'Git:',
    '  git init                      mulai repository',
    '  git status                    lihat kondisi file',
    '  git add <file> | .            pindah ke Staging Area',
    '  git commit -m "pesan"         simpan commit',
    '  git log [--oneline]           lihat riwayat',
    '  git diff [--staged]           lihat perubahan',
    '  git branch [nama]             lihat / buat branch',
    '  git checkout [-b] <nama>      pindah (atau buat) branch',
    '  git switch [-c] <nama>        versi baru dari checkout',
    '  git merge <branch>            gabungkan branch',
    '  git reset [--soft|--hard] HEAD~1   mundur',
    '  git restore [--staged] <file> batalkan perubahan',
    'Remote (simulasi GitHub):',
    '  git remote add origin <url>   hubungkan remote',
    '  git push [-u origin <branch>] kirim commit',
    '  git fetch                     ambil kabar tanpa menggabung',
    '  git pull                      fetch + merge',
    '  git clone <url>               unduh dari remote (folder kosong)',
    'Bantuan (bukan git asli):',
    '  touch <file>   buat file    edit <file>   ubah isi file',
    '  rm <file>      hapus file   ls           daftar file',
    '  clear          bersihkan terminal',
  ];

  function promptParts() {
    const s = engine.s;
    let br = '';
    if (s.inited) br = s.head.branch ? s.head.branch : s.head.id || 'no-commit';
    return br;
  }
  function fillPrompt(node) {
    const mk = (cls, text) => {
      const sp = document.createElement('span');
      sp.className = cls;
      sp.textContent = text;
      node.appendChild(sp);
    };
    mk('p-user', 'kamu@laptop');
    mk('p-sign', ':');
    mk('p-path', '~/proyek');
    const br = promptParts();
    if (br) mk('p-branch', ' (' + br + ')');
    mk('p-sign', '$ ');
  }
  function echo(text, suffix) {
    const d = document.createElement('div');
    d.className = 'line echo';
    const pr = document.createElement('span');
    pr.className = 'prompt-inline';
    fillPrompt(pr);
    d.appendChild(pr);
    const c = document.createElement('span');
    c.className = 'cmdtext';
    c.textContent = text;
    d.appendChild(c);
    if (suffix) d.appendChild(document.createTextNode(suffix));
    term.appendChild(d);
  }
  function updatePrompt() {
    const p = $('prompt');
    p.textContent = '';
    fillPrompt(p);
  }

  function print(text, cls) {
    const d = document.createElement('div');
    d.className = 'line ' + (cls || '');
    d.textContent = text;
    term.appendChild(d);
  }
  function printLines(lines) {
    lines.forEach((l) => print(l.t, l.c));
    term.scrollTop = term.scrollHeight;
  }

  const LESSONS = [
    { title: 'Mulai repository', why: 'Supaya git mulai mencatat sejarah folder ini.', cmds: ['git init'], done: () => engine.s.inited },
    { title: 'Buat sebuah file', why: 'File baru muncul di Working Directory, tapi git belum tahu.', cmds: ['touch index.html'], done: () => Object.keys(engine.s.work).length > 0 },
    { title: 'Cek status', why: 'Status memberi tahu file mana yang baru, berubah, atau siap di-commit.', cmds: ['git status'], done: () => used.has('status') },
    { title: 'Masukkan ke Staging Area', why: 'Pilih file apa saja yang akan ikut dicatat.', cmds: ['git add index.html'], done: () => used.has('add') },
    { title: 'Commit pertama', why: 'Commit = foto proyekmu pada saat ini, lengkap dengan pesan.', cmds: ['git commit -m "Commit pertamaku"'], done: () => Object.keys(engine.s.commits).length >= 1 },
    { title: 'Ubah file & commit lagi', why: 'Setiap commit menambah satu node ke riwayat.', cmds: ['edit index.html', 'git add .', 'git commit -m "Ubah isi file"'], done: () => Object.keys(engine.s.commits).length >= 2 },
    { title: 'Lihat riwayat', why: 'Log menampilkan semua commit dari yang terbaru.', cmds: ['git log --oneline'], done: () => used.has('log') },
    { title: 'Buat branch baru', why: 'Branch = jalur terpisah untuk mencoba hal baru tanpa merusak main.', cmds: ['git checkout -b fitur'], done: () => Object.keys(engine.s.branches).length >= 2 },
    { title: 'Commit di branch', why: 'Commit ini hanya masuk ke branch fitur. Lihat grafnya bercabang.', cmds: ['touch fitur.txt', 'git add .', 'git commit -m "Tambah fitur"'], done: () => { const b = engine.s.branches; return Object.keys(b).length >= 2 && new Set(Object.values(b)).size >= 2; } },
    { title: 'Kembali ke main', why: 'Pindah branch juga mengubah isi folder kerjamu.', cmds: ['git checkout main'], done: () => engine.s.head.branch === 'main' && used.has('checkout') && Object.keys(engine.s.branches).length >= 2 },
    { title: 'Gabungkan (merge)', why: 'Bawa hasil kerja branch fitur ke main.', cmds: ['git merge fitur'], done: () => used.has('merge') },
    { title: 'Hubungkan ke remote', why: 'Remote = salinan repository di server (seperti GitHub). Daftarkan alamatnya dengan nama origin.', cmds: ['git remote add origin https://github.com/kamu/proyek.git', 'git remote -v'], done: () => !!engine.s.remoteUrl },
    { title: 'Kirim ke remote (push)', why: 'Push mengirim commit lokalmu ke remote. Pakai -u sekali saja supaya selanjutnya cukup git push.', cmds: ['git push -u origin main'], done: () => used.has('push') && !!engine.s.hub.branches.main },
    { title: 'Ambil kabar remote (fetch)', why: 'Temanmu mengirim commit ke remote. Fetch mengambil kabarnya tanpa mengubah branch-mu. Lihat label origin/main maju sendiri.', cmds: ['@teman', 'git fetch', 'git status'], done: () => used.has('fetch') },
    { title: 'Gabungkan kabar remote (pull)', why: 'Pull = fetch + merge. Branch lokalmu ikut maju.', cmds: ['git pull'], done: () => used.has('pull') },
    { title: 'Push ditolak, lalu pull', why: 'Kalau remote punya commit yang belum kamu punya, push ditolak. Selesaikan dengan pull dulu.', cmds: ['@teman', 'touch lokal.txt', 'git add .', 'git commit -m "Kerja lokal"', 'git push', 'git pull', 'git push'], done: () => used.has('push-rejected') && !!engine.s.branches.main && engine.s.hub.branches.main === engine.s.branches.main },
    { title: 'Clone repository', why: 'Clone mengunduh seluruh repository dari remote ke folder kosong. Hapus dulu folder lokalnya (remote tetap aman).', cmds: ['@hapus', 'git clone https://github.com/kamu/proyek.git'], done: () => used.has('clone') },
  ];

  function renderLessons() {
    const ol = $('lessons');
    ol.textContent = '';
    let current = -1;
    let doneCount = 0;
    LESSONS.forEach((l, i) => {
      const d = l.done();
      if (d) doneCount++;
      else if (current < 0) current = i;
    });
    LESSONS.forEach((l, i) => {
      const li = document.createElement('li');
      const isDone = l.done();
      li.className = (isDone ? 'done ' : '') + (i === current ? 'current' : '');
      const t = document.createElement('div');
      t.className = 'l-title';
      t.textContent = (isDone ? '✅ ' : i === current ? '👉 ' : '⬜ ') + l.title;
      li.appendChild(t);
      if (i === current) {
        const p = document.createElement('p');
        p.textContent = l.why;
        li.appendChild(p);
        const box = document.createElement('div');
        box.className = 'cmds';
        l.cmds.forEach((c) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cmd-btn';
          if (c[0] === '@') {
            b.className += ' action';
            b.textContent = c === '@teman' ? '👥 Teman push commit' : '🗑 Hapus folder lokal';
            b.addEventListener('click', c === '@teman' ? friend : wipeLocal);
          } else {
            b.textContent = c;
            b.addEventListener('click', () => run(c));
          }
          box.appendChild(b);
        });
        li.appendChild(box);
      }
      ol.appendChild(li);
    });
    $('progress').textContent = doneCount + ' / ' + LESSONS.length + ' selesai';
    if (doneCount === LESSONS.length) {
      const li = document.createElement('li');
      li.className = 'current';
      li.textContent = '🎉 Semua misi selesai! Coba bebas: git reset, git diff, git switch...';
      ol.appendChild(li);
    }
  }

  function run(line) {
    line = line.trim();
    if (!line) return;
    echo(line);
    history.push(line);
    hIdx = history.length;
    if (line === 'clear') {
      term.textContent = '';
    } else if (line === 'help') {
      printLines(HELP.map((t) => ({ t: t, c: '' })));
    } else {
      const r = engine.exec(line);
      if (r.key) used.add(r.key);
      printLines(r.lines);
    }
    input.value = '';
    updatePrompt();
    viz.render();
    renderLessons();
    term.scrollTop = term.scrollHeight;
  }

  function refresh() {
    updatePrompt();
    viz.render();
    renderLessons();
    term.scrollTop = term.scrollHeight;
  }

  function friend() {
    const r = engine.friendCommit();
    if (r.key) used.add(r.key);
    printLines(r.lines);
    refresh();
  }

  function wipeLocal() {
    engine.localReset();
    used.delete('clone');
    print('Folder lokal dikosongkan. Remote (GitHub) tetap menyimpan semua commit.', 'info');
    refresh();
  }

  function restart() {
    engine.restart();
    used = new Set();
    term.textContent = '';
    viz.seen = {};
    print('Selamat datang! Ikuti misi di kiri, atau ketik "help".', 'info');
    print('Tips: Tab = lengkapi otomatis, ↑ ↓ = riwayat command, Ctrl+L = bersihkan.', 'info');
    updatePrompt();
    viz.render();
    renderLessons();
  }

  $('term-form').addEventListener('submit', (e) => {
    e.preventDefault();
    run(input.value);
  });
  let lastTab = null;
  function commonPrefix(list) {
    return list.reduce((a, b) => {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    });
  }
  function onTab() {
    const val = input.value;
    const { cur, cands } = engine.complete(val);
    if (!cands.length) return;
    const base = val.slice(0, val.length - cur.length);
    const lcp = commonPrefix(cands);
    if (cands.length === 1) {
      input.value = base + cands[0] + ' ';
      lastTab = null;
    } else if (lcp.length > cur.length) {
      input.value = base + lcp;
      lastTab = null;
    } else if (lastTab === val) {
      echo(val);
      print(cands.join('   '), 'cands');
      term.scrollTop = term.scrollHeight;
      lastTab = null;
    } else {
      lastTab = val;
    }
  }
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') lastTab = null;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      onTab();
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      hIdx = Math.max(0, hIdx - 1);
      input.value = history[hIdx];
    } else if (e.key === 'ArrowDown' && history.length) {
      e.preventDefault();
      hIdx = Math.min(history.length, hIdx + 1);
      input.value = history[hIdx] || '';
    } else if (e.ctrlKey && !e.altKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const hasSel = input.selectionStart !== input.selectionEnd;
      if (k === 'l') {
        e.preventDefault();
        term.textContent = '';
      } else if (k === 'c' && !hasSel) {
        e.preventDefault();
        echo(input.value, '^C');
        input.value = '';
        term.scrollTop = term.scrollHeight;
      } else if (k === 'u') {
        e.preventDefault();
        input.value = input.value.slice(input.selectionStart);
        input.setSelectionRange(0, 0);
      } else if (k === 'k') {
        e.preventDefault();
        input.value = input.value.slice(0, input.selectionStart);
      } else if (k === 'a') {
        e.preventDefault();
        input.setSelectionRange(0, 0);
      } else if (k === 'e') {
        e.preventDefault();
        input.setSelectionRange(input.value.length, input.value.length);
      } else if (k === 'w') {
        e.preventDefault();
        const pos = input.selectionStart;
        const left = input.value.slice(0, pos).replace(/\s*\S*$/, '');
        input.value = left + input.value.slice(pos);
        input.setSelectionRange(left.length, left.length);
      }
    }
  });
  $('btn-help').addEventListener('click', () => run('help'));
  $('btn-reset').addEventListener('click', restart);
  $('btn-friend').addEventListener('click', friend);
  $('btn-wipe').addEventListener('click', wipeLocal);
  term.addEventListener('click', () => {
    if (!getSelection().toString()) input.focus();
  });

  restart();
})();
