/* Simulasi git sederhana, semua di memori browser. */
(function (global) {
  'use strict';

  const T = (t, c) => ({ t: t, c: c || '' });
  const flat = (items) => items.flat().map((i) => (typeof i === 'string' ? T(i) : i));
  const ok = (key, ...items) => ({ ok: true, key: key, lines: flat(items) });
  const fail = (lines, hint, key) => {
    const out = flat([lines]).map((l) => T(l.t, 'err'));
    if (hint) out.push(T('💡 ' + hint, 'hint'));
    return { ok: false, key: key, lines: out };
  };
  const hint = (text) => T('💡 ' + text, 'hint');

  function tokenize(s) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(s))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    return out;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  const VALID_NAME = /^[A-Za-z0-9_][\w.\-/]*$/;

  class GitEngine {
    constructor() {
      this.restart();
    }

    restart() {
      this.s = {
        inited: false,
        commits: {},
        branches: {},
        head: { branch: 'main', id: null },
        work: {},
        index: {},
        seq: 0,
        hub: { branches: {} },
        remoteUrl: null,
        tracking: {},
        upstream: {},
        friendN: 0,
      };
    }

    /* hapus folder lokal, remote (hub) tetap ada */
    localReset() {
      const hub = this.s.hub;
      const friendN = this.s.friendN;
      const commits = this.s.commits;
      const seq = this.s.seq;
      this.restart();
      this.s.hub = hub;
      this.s.friendN = friendN;
      this.s.commits = commits;
      this.s.seq = seq;
    }

    /* ---------- helpers ---------- */
    headId() {
      const h = this.s.head;
      return h.branch ? this.s.branches[h.branch] || null : h.id;
    }
    commitFiles(id) {
      return id ? this.s.commits[id].files : {};
    }
    setHead(id) {
      const h = this.s.head;
      if (h.branch) this.s.branches[h.branch] = id;
      else h.id = id;
    }
    changes() {
      const s = this.s;
      const hf = this.commitFiles(this.headId());
      const staged = [];
      const unstaged = [];
      const untracked = [];
      new Set([...Object.keys(s.index), ...Object.keys(hf)]).forEach((n) => {
        if (!(n in hf)) staged.push([n, 'new file']);
        else if (!(n in s.index)) staged.push([n, 'deleted']);
        else if (hf[n] !== s.index[n]) staged.push([n, 'modified']);
      });
      Object.keys(s.index).forEach((n) => {
        if (!(n in s.work)) unstaged.push([n, 'deleted']);
        else if (s.work[n] !== s.index[n]) unstaged.push([n, 'modified']);
      });
      Object.keys(s.work).forEach((n) => {
        if (!(n in s.index)) untracked.push(n);
      });
      staged.sort();
      unstaged.sort();
      untracked.sort();
      return { staged, unstaged, untracked };
    }
    ancestors(id) {
      const seen = new Set();
      const stack = [id];
      while (stack.length) {
        const c = stack.pop();
        if (!c || seen.has(c)) continue;
        seen.add(c);
        stack.push(...this.s.commits[c].parents);
      }
      return seen;
    }
    reachable() {
      const roots = Object.values(this.s.branches).concat(Object.values(this.s.tracking), [this.headId()]);
      const all = new Set();
      roots.forEach((r) => r && this.ancestors(r).forEach((x) => all.add(x)));
      return [...all].map((id) => this.s.commits[id]).sort((a, b) => a.seq - b.seq);
    }
    hubReachable() {
      const all = new Set();
      Object.values(this.s.hub.branches).forEach((r) => this.ancestors(r).forEach((x) => all.add(x)));
      return [...all].map((id) => this.s.commits[id]).sort((a, b) => a.seq - b.seq);
    }
    resolve(ref) {
      const m = /^([^~^]+)(?:~(\d+)|\^)?$/.exec(ref);
      if (!m) return null;
      const s = this.s;
      let id = null;
      if (m[1] === 'HEAD') id = this.headId();
      else if (s.branches[m[1]]) id = s.branches[m[1]];
      else if (s.tracking[m[1]]) id = s.tracking[m[1]];
      else if (m[1].length >= 4) {
        const hits = Object.keys(s.commits).filter((c) => c.startsWith(m[1]));
        if (hits.length === 1) id = hits[0];
      }
      let steps = m[2] !== undefined ? parseInt(m[2], 10) : ref.includes('^') ? 1 : 0;
      while (id && steps-- > 0) id = s.commits[id].parents[0] || null;
      return id;
    }
    labelsFor(id) {
      const s = this.s;
      const parts = [];
      const names = Object.keys(s.branches).filter((b) => s.branches[b] === id).concat(Object.keys(s.tracking).filter((b) => s.tracking[b] === id));
      if (this.headId() === id) {
        if (s.head.branch) {
          parts.push('HEAD -> ' + s.head.branch);
          names.filter((b) => b !== s.head.branch).forEach((b) => parts.push(b));
        } else {
          parts.push('HEAD');
          names.forEach((b) => parts.push(b));
        }
      } else names.forEach((b) => parts.push(b));
      return parts.length ? ' (' + parts.join(', ') + ')' : '';
    }
    dirtyTracked() {
      const c = this.changes();
      return c.staged.length || c.unstaged.length;
    }
    applyFiles(files) {
      const s = this.s;
      const untracked = Object.keys(s.work).filter((n) => !(n in s.index));
      const work = Object.assign({}, files);
      untracked.forEach((n) => {
        if (!(n in work)) work[n] = s.work[n];
      });
      s.work = work;
      s.index = Object.assign({}, files);
    }
    makeCommit(msg, parents, files) {
      const s = this.s;
      s.seq += 1;
      let id = hash(msg + s.seq + Date.now()).slice(0, 7);
      while (s.commits[id]) id = hash(id + 'x').slice(0, 7);
      s.commits[id] = { id: id, msg: msg, parents: parents, files: files, seq: s.seq, time: Date.now() };
      return id;
    }

    /* ---------- entry ---------- */
    exec(line) {
      const tk = tokenize(line.trim());
      if (!tk.length) return ok('');
      const cmd = tk[0];
      const args = tk.slice(1);
      switch (cmd) {
        case 'git':
          return this.git(args);
        case 'touch':
          return this.touch(args);
        case 'edit':
          return this.edit(args);
        case 'rm':
          return this.rm(args);
        case 'ls':
          return ok('ls', Object.keys(this.s.work).sort().join('  ') || '(folder kosong)');
        default:
          return fail("Command '" + cmd + "' tidak dikenal.", "Ketik 'help' untuk melihat daftar command yang bisa dipakai.");
      }
    }

    /* ---------- helper commands ---------- */
    touch(args) {
      if (!args.length) return fail('touch: nama file kosong', 'Contoh: touch index.html');
      const made = [];
      for (const n of args) {
        if (!VALID_NAME.test(n)) return fail("touch: nama file '" + n + "' tidak valid", 'Pakai huruf, angka, titik, atau strip. Contoh: index.html');
        if (!(n in this.s.work)) {
          this.s.work[n] = 1;
          made.push(n);
        }
      }
      return ok('touch', made.length ? hint('File ' + made.join(', ') + ' dibuat di Working Directory (folder kerjamu). Git belum mencatatnya.') : hint('File itu sudah ada.'));
    }
    edit(args) {
      const n = args[0];
      if (!n) return fail('edit: nama file kosong', 'Contoh: edit index.html');
      if (!(n in this.s.work)) return fail("edit: file '" + n + "' tidak ada", "Buat dulu dengan: touch " + n);
      this.s.work[n] += 1;
      return ok('edit', hint("Isi '" + n + "' berubah. Kalau sudah di-commit sebelumnya, git akan melihatnya sebagai modified."));
    }
    rm(args) {
      const n = args[0];
      if (!n || !(n in this.s.work)) return fail("rm: file '" + (n || '') + "' tidak ada");
      delete this.s.work[n];
      return ok('rm', hint("File '" + n + "' dihapus dari folder kerja."));
    }

    /* ---------- git ---------- */
    git(args) {
      const sub = args[0];
      const rest = args.slice(1);
      if (!sub || sub === 'help' || sub === '--help') {
        return ok('git', 'Command git yang tersedia di sini:', '  init  status  add  commit  log  diff', '  branch  checkout  switch  merge  reset  restore', '  remote  push  fetch  pull  clone');
      }
      if (sub === '--version') return ok('git', 'git version 2.x (simulasi)');
      if (sub === 'init') return this.init();
      if (sub === 'clone') return this.clone(rest);
      const known = ['status', 'add', 'commit', 'log', 'diff', 'branch', 'checkout', 'switch', 'merge', 'reset', 'restore', 'remote', 'push', 'fetch', 'pull'];
      if (!known.includes(sub)) return fail("git: '" + sub + "' bukan command git yang dikenal di sini.", "Ketik 'git help' untuk daftar command.");
      if (!this.s.inited) {
        return fail('fatal: not a git repository (or any of the parent directories): .git', "Folder ini belum dijaga git. Jalankan dulu: git init");
      }
      return this[sub](rest);
    }

    init() {
      if (this.s.inited) return ok('init', 'Reinitialized existing Git repository in .git/', hint('Repository sudah ada, tidak perlu init lagi.'));
      this.s.inited = true;
      return ok('init', 'Initialized empty Git repository in .git/', hint('Folder ini sekarang punya "buku catatan" git (folder tersembunyi .git).'));
    }

    status() {
      const s = this.s;
      const c = this.changes();
      const out = [];
      out.push(s.head.branch ? 'On branch ' + s.head.branch : 'HEAD detached at ' + s.head.id);
      if (!this.headId()) out.push('', 'No commits yet');
      const up = s.head.branch && s.upstream[s.head.branch];
      if (up && s.tracking[up] && this.headId()) {
        const mine = this.ancestors(this.headId());
        const theirs = this.ancestors(s.tracking[up]);
        const ahead = [...mine].filter((x) => !theirs.has(x)).length;
        const behind = [...theirs].filter((x) => !mine.has(x)).length;
        const pl = (n) => n + ' commit' + (n > 1 ? 's' : '');
        if (ahead && behind) out.push("Your branch and '" + up + "' have diverged,", 'and have ' + ahead + ' and ' + behind + ' different commits each, respectively.', '  (use "git pull" to merge the remote branch into yours)');
        else if (ahead) out.push("Your branch is ahead of '" + up + "' by " + pl(ahead) + '.', '  (use "git push" to publish your local commits)');
        else if (behind) out.push("Your branch is behind '" + up + "' by " + pl(behind) + ', and can be fast-forwarded.', '  (use "git pull" to update your local branch)');
        else out.push("Your branch is up to date with '" + up + "'.");
      }
      if (c.staged.length) {
        out.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)');
        c.staged.forEach(([n, k]) => out.push(T('\t' + (k + ':').padEnd(12) + n, 'good')));
      }
      if (c.unstaged.length) {
        out.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)');
        c.unstaged.forEach(([n, k]) => out.push(T('\t' + (k + ':').padEnd(12) + n, 'bad')));
      }
      if (c.untracked.length) {
        out.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
        c.untracked.forEach((n) => out.push(T('\t' + n, 'bad')));
      }
      if (!c.staged.length && !c.unstaged.length && !c.untracked.length) {
        out.push(this.headId() ? 'nothing to commit, working tree clean' : 'nothing to commit (create/copy files and use "git add" to track)');
      } else if (!c.staged.length) {
        out.push('', 'no changes added to commit (use "git add" and/or "git commit -a")');
      }
      out.push(hint('Merah = belum disiapkan, hijau = sudah di Staging Area dan siap di-commit.'));
      return ok('status', out);
    }

    add(args) {
      const s = this.s;
      if (!args.length) return fail('Nothing specified, nothing added.', 'Contoh: git add index.html  atau  git add .');
      for (const p of args) {
        if (p === '.' || p === '-A' || p === '--all') {
          Object.keys(s.work).forEach((n) => (s.index[n] = s.work[n]));
          Object.keys(s.index).forEach((n) => {
            if (!(n in s.work)) delete s.index[n];
          });
        } else if (p in s.work) s.index[p] = s.work[p];
        else if (p in s.index) delete s.index[p];
        else return fail("fatal: pathspec '" + p + "' did not match any files", "Cek nama file dengan 'ls'.");
      }
      return ok('add', hint('File dipindah ke Staging Area (area persiapan sebelum commit).'));
    }

    commit(args) {
      const s = this.s;
      let msg = null;
      let all = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-m') msg = args[++i];
        else if (a === '-am' || a === '-ma') {
          all = true;
          msg = args[++i];
        } else if (a === '-a') all = true;
        else if (a.startsWith('-m') && a.length > 2) msg = a.slice(2);
      }
      if (all) {
        Object.keys(s.index).forEach((n) => {
          if (n in s.work) s.index[n] = s.work[n];
          else delete s.index[n];
        });
      }
      const c = this.changes();
      if (!c.staged.length) {
        if (c.untracked.length) return fail('nothing added to commit but untracked files present (use "git add" to track)', "Masukkan file ke Staging Area dulu: git add <file>");
        return fail('nothing to commit, working tree clean', 'Tidak ada perubahan baru untuk dicatat. Coba: edit <file>');
      }
      if (!msg) return fail('Aborting commit due to empty commit message.', 'Tulis pesan commit: git commit -m "pesan kamu"');
      const parent = this.headId();
      const id = this.makeCommit(msg, parent ? [parent] : [], Object.assign({}, s.index));
      this.setHead(id);
      const where = (s.head.branch || 'detached HEAD') + (parent ? '' : ' (root-commit)');
      return ok('commit', '[' + where + ' ' + id + '] ' + msg, ' ' + c.staged.length + ' file changed', hint('Satu "foto" proyekmu tersimpan di Repository. Lihat node baru di graph!'));
    }

    log(args) {
      const head = this.headId();
      if (!head) return fail("fatal: your current branch '" + (this.s.head.branch || '') + "' does not have any commits yet", 'Buat commit dulu: git add . lalu git commit -m "pesan"');
      const one = args.includes('--oneline');
      const list = [...this.ancestors(head)].map((i) => this.s.commits[i]).sort((a, b) => b.seq - a.seq);
      const out = [];
      list.forEach((c) => {
        if (one) out.push(T(c.id + this.labelsFor(c.id) + ' ' + c.msg));
        else {
          out.push(T('commit ' + c.id + this.labelsFor(c.id), 'warn'));
          if (c.parents.length > 1) out.push('Merge: ' + c.parents.join(' '));
          out.push('Author: Kamu <kamu@example.com>', 'Date:   ' + new Date(c.time).toLocaleString('id-ID'), '', '    ' + c.msg, '');
        }
      });
      out.push(hint('Log menampilkan sejarah commit dari yang terbaru. Coba juga: git log --oneline'));
      return ok('log', out);
    }

    diff(args) {
      const s = this.s;
      const staged = args.includes('--staged') || args.includes('--cached');
      const hf = this.commitFiles(this.headId());
      const from = staged ? hf : s.index;
      const to = staged ? s.index : s.work;
      const out = [];
      new Set([...Object.keys(from), ...Object.keys(to)]).forEach((n) => {
        if (!staged && !(n in s.index)) return;
        if (from[n] === to[n]) return;
        out.push('diff --git a/' + n + ' b/' + n);
        if (!(n in from)) out.push(T('+++ new file: ' + n + ' (versi ' + to[n] + ')', 'good'));
        else if (!(n in to)) out.push(T('--- deleted file: ' + n, 'bad'));
        else out.push(T('-versi ' + from[n], 'bad'), T('+versi ' + to[n], 'good'));
      });
      if (!out.length) out.push(staged ? '(tidak ada perubahan di Staging Area)' : '(tidak ada perubahan yang belum di-stage)');
      out.push(hint('diff menunjukkan apa yang berubah. Merah = lama, hijau = baru.'));
      return ok('diff', out);
    }

    branch(args) {
      const s = this.s;
      const names = args.filter((a) => !a.startsWith('-'));
      if (args[0] === '-d' || args[0] === '-D') {
        const n = args[1];
        if (!n || !(n in s.branches)) return fail("error: branch '" + (n || '') + "' not found");
        if (s.head.branch === n) return fail("error: Cannot delete branch '" + n + "' checked out", 'Pindah dulu ke branch lain: git checkout main');
        const id = s.branches[n];
        delete s.branches[n];
        return ok('branch-d', 'Deleted branch ' + n + ' (was ' + id + ').');
      }
      if (!names.length) {
        const list = new Set(Object.keys(s.branches));
        if (s.head.branch) list.add(s.head.branch);
        const out = [...list].sort().map((n) => T((n === s.head.branch ? '* ' : '  ') + n, n === s.head.branch ? 'good' : ''));
        out.push(hint('Tanda * adalah branch tempatmu berada sekarang.'));
        return ok('branch-list', out);
      }
      return this.createBranch(names[0], names[1]);
    }

    createBranch(name, start) {
      const s = this.s;
      if (!VALID_NAME.test(name)) return fail("fatal: '" + name + "' is not a valid branch name", 'Pakai huruf, angka, strip. Contoh: fitur-login');
      if (name in s.branches) return fail("fatal: a branch named '" + name + "' already exists");
      const id = start ? this.resolve(start) : this.headId();
      if (!id) return fail("fatal: not a valid object name: '" + (start || s.head.branch) + "'", 'Branch butuh minimal 1 commit. Buat commit dulu.');
      s.branches[name] = id;
      return ok('branch', hint("Branch '" + name + "' dibuat. Branch hanyalah penunjuk ke sebuah commit. Pindah ke sana dengan: git checkout " + name));
    }

    moveTo(id, branch, createdMsg) {
      const s = this.s;
      if (id !== this.headId()) {
        if (this.dirtyTracked()) {
          const names = this.changes().staged.concat(this.changes().unstaged).map((x) => '\t' + x[0]);
          return fail(['error: Your local changes would be overwritten by checkout:'].concat(names, ['Please commit your changes before you switch branches.', 'Aborting']), 'Simpan dulu pekerjaanmu: git add . lalu git commit -m "pesan"');
        }
        this.applyFiles(this.commitFiles(id));
      }
      if (branch) {
        s.head = { branch: branch, id: null };
        return ok('checkout', createdMsg || "Switched to branch '" + branch + "'", hint("HEAD sekarang menunjuk ke branch '" + branch + "'. Commit berikutnya akan masuk ke sini."));
      }
      s.head = { branch: null, id: id };
      return ok('checkout', 'HEAD is now at ' + id + ' ' + s.commits[id].msg, hint('Detached HEAD: kamu melihat commit lama. Kembali dengan: git checkout main'));
    }

    checkout(args) {
      const s = this.s;
      if (args[0] === '-b' || args[0] === '-B') {
        const name = args[1];
        if (!name) return fail('fatal: switch `b\' requires a value', 'Contoh: git checkout -b fitur-baru');
        if (!this.headId()) {
          if (!VALID_NAME.test(name)) return fail("fatal: '" + name + "' is not a valid branch name");
          s.head = { branch: name, id: null };
          return ok('checkout-b', "Switched to a new branch '" + name + "'");
        }
        const r = this.createBranch(name, args[2]);
        if (!r.ok) return r;
        const m = this.moveTo(s.branches[name], name, "Switched to a new branch '" + name + "'");
        if (!m.ok) delete s.branches[name];
        else m.key = 'checkout-b';
        return m;
      }
      if (args[0] === '--') return this.restore(args.slice(1));
      const t = args[0];
      if (!t) return fail('Tulis tujuan checkout.', 'Contoh: git checkout main');
      if (t in s.branches) return this.moveTo(s.branches[t], t);
      if (t === s.head.branch) return ok('checkout', "Already on '" + t + "'");
      if (t in s.work && !this.resolve(t)) return this.restore([t]);
      const id = this.resolve(t);
      if (id) return this.moveTo(id, null);
      return fail("error: pathspec '" + t + "' did not match any file(s) known to git", "Cek daftar branch dengan: git branch");
    }

    switch(args) {
      const s = this.s;
      if (args[0] === '-c' || args[0] === '--create') {
        const r = this.checkout(['-b'].concat(args.slice(1)));
        if (r.ok) r.key = 'checkout-b';
        return r;
      }
      const t = args[0];
      if (!t) return fail('missing branch name', 'Contoh: git switch main');
      if (t === s.head.branch) return ok('switch', "Already on '" + t + "'");
      if (!(t in s.branches)) return fail("fatal: invalid reference: " + t, 'Lihat branch yang ada: git branch. Buat baru: git switch -c ' + t);
      return this.moveTo(s.branches[t], t);
    }

    restore(args) {
      const s = this.s;
      const staged = args.includes('--staged');
      const files = args.filter((a) => !a.startsWith('-'));
      if (!files.length) return fail('you must specify path(s) to restore');
      const hf = this.commitFiles(this.headId());
      for (const n of files) {
        if (staged) {
          if (n in hf) s.index[n] = hf[n];
          else delete s.index[n];
        } else if (n in s.index) s.work[n] = s.index[n];
        else return fail("error: pathspec '" + n + "' did not match any file(s) known to git");
      }
      return ok('restore', hint(staged ? 'File dikeluarkan dari Staging Area (isi file tidak berubah).' : 'Perubahan di file dibatalkan, kembali ke versi terakhir.'));
    }

    merge(args, mergeMsg) {
      const s = this.s;
      const name = args.filter((a) => !a.startsWith('-'))[0];
      if (!name) return fail('No branch specified.', 'Contoh: git merge fitur-baru (jalankan dari branch tujuan, biasanya main)');
      const target = s.branches[name] || this.resolve(name);
      if (!target) return fail(name + ' - not something we can merge', 'Cek nama branch dengan: git branch');
      const head = this.headId();
      if (!head) return fail('fatal: tidak ada commit untuk digabung');
      if (target === head || this.ancestors(head).has(target)) return ok('merge', 'Already up to date.', hint('Branch itu tidak punya commit baru untuk digabung.'));
      if (this.dirtyTracked()) return fail('error: Your local changes would be overwritten by merge.', 'Commit dulu perubahanmu sebelum merge.');
      if (this.ancestors(target).has(head)) {
        this.setHead(target);
        this.applyFiles(this.commitFiles(target));
        return ok('merge', 'Updating ' + head + '..' + target, 'Fast-forward', hint('Fast-forward: branch tujuan tidak punya commit baru, jadi penunjuknya tinggal digeser maju.'));
      }
      const mine = this.ancestors(head);
      const base = [...this.ancestors(target)].filter((i) => mine.has(i)).sort((a, b) => s.commits[b].seq - s.commits[a].seq)[0];
      const bf = this.commitFiles(base);
      const of = this.commitFiles(head);
      const tf = this.commitFiles(target);
      const merged = {};
      new Set([...Object.keys(of), ...Object.keys(tf)]).forEach((n) => {
        let v;
        if (of[n] === tf[n]) v = of[n];
        else if (of[n] === bf[n]) v = tf[n];
        else if (tf[n] === bf[n]) v = of[n];
        else v = tf[n];
        if (v !== undefined) merged[n] = v;
      });
      const id = this.makeCommit(mergeMsg || "Merge branch '" + name + "'", [head, target], merged);
      this.setHead(id);
      this.applyFiles(merged);
      return ok('merge', "Merge made by the 'ort' strategy.", hint('Dua jalur sejarah disatukan oleh sebuah merge commit yang punya 2 parent. (Konflik tidak disimulasikan di sini.)'));
    }

    reset(args) {
      const s = this.s;
      let mode = 'mixed';
      const rest = [];
      args.forEach((a) => {
        if (a === '--soft') mode = 'soft';
        else if (a === '--hard') mode = 'hard';
        else if (a === '--mixed') mode = 'mixed';
        else rest.push(a);
      });
      if (rest.length && !this.resolve(rest[0]) && rest.every((f) => f in s.index)) {
        const hf = this.commitFiles(this.headId());
        rest.forEach((n) => (n in hf ? (s.index[n] = hf[n]) : delete s.index[n]));
        return ok('reset', hint('File dikeluarkan dari Staging Area.'));
      }
      const target = this.resolve(rest[0] || 'HEAD');
      if (!target) return fail("fatal: ambiguous argument '" + (rest[0] || 'HEAD') + "': unknown revision", 'Contoh: git reset --soft HEAD~1');
      const files = this.commitFiles(target);
      this.setHead(target);
      if (mode !== 'soft') s.index = Object.assign({}, files);
      if (mode === 'hard') {
        const untracked = Object.keys(s.work).filter((n) => !(n in s.index) && !(n in files));
        const work = Object.assign({}, files);
        untracked.forEach((n) => (work[n] = s.work[n]));
        s.work = work;
      }
      const note = {
        soft: '--soft: HEAD mundur, file tetap di Staging Area.',
        mixed: '--mixed: HEAD mundur, file kembali ke Working Directory (belum di-stage).',
        hard: '--hard: HEAD mundur DAN semua perubahan dibuang. Hati-hati!',
      }[mode];
      return ok('reset', mode === 'hard' ? 'HEAD is now at ' + target + ' ' + s.commits[target].msg : '', hint(note));
    }

    /* ---------- remote (simulasi GitHub) ---------- */
    remote(args) {
      const s = this.s;
      if (args[0] === 'add') {
        if (args[1] !== 'origin' || !args[2]) return fail('usage: git remote add origin <url>', 'Contoh: git remote add origin https://github.com/kamu/proyek.git');
        if (s.remoteUrl) return fail('error: remote origin already exists.');
        s.remoteUrl = args[2];
        return ok('remote-add', hint('Repository lokalmu sekarang tahu alamat remote bernama "origin". Belum ada yang terkirim.'));
      }
      if (args[0] === 'remove' || args[0] === 'rm') {
        if (!s.remoteUrl) return fail("error: No such remote: 'origin'");
        s.remoteUrl = null;
        s.tracking = {};
        s.upstream = {};
        return ok('remote-rm');
      }
      if (!s.remoteUrl) return ok('remote', hint('Belum ada remote. Hubungkan dengan: git remote add origin <url>'));
      if (args.includes('-v')) return ok('remote', 'origin\t' + s.remoteUrl + ' (fetch)', 'origin\t' + s.remoteUrl + ' (push)');
      return ok('remote', 'origin');
    }

    noRemote() {
      return fail("fatal: 'origin' does not appear to be a git repository", 'Hubungkan dulu: git remote add origin https://github.com/kamu/proyek.git');
    }

    doFetch() {
      const s = this.s;
      const out = [];
      Object.keys(s.hub.branches).sort().forEach((b) => {
        const id = s.hub.branches[b];
        const key = 'origin/' + b;
        const old = s.tracking[key];
        if (old === id) return;
        s.tracking[key] = id;
        out.push(old ? '   ' + old + '..' + id + '  ' + b + ' -> ' + key : ' * [new branch]      ' + b + ' -> ' + key);
      });
      return out;
    }

    fetch() {
      const s = this.s;
      if (!s.remoteUrl) return this.noRemote();
      const out = this.doFetch();
      if (!out.length) return ok('fetch', hint('Tidak ada kabar baru dari remote.'));
      return ok('fetch', 'From ' + s.remoteUrl, out, hint('origin/... bergerak, tapi branch lokalmu belum. Fetch hanya mengambil, tidak menggabungkan. Gunakan git pull / git merge origin/main.'));
    }

    push(args) {
      const s = this.s;
      const pos = args.filter((a) => !a.startsWith('-'));
      const setUp = args.includes('-u') || args.includes('--set-upstream');
      if (!s.remoteUrl) return this.noRemote();
      if (pos[0] && pos[0] !== 'origin') return fail("fatal: '" + pos[0] + "' does not appear to be a git repository", 'Di sini remote-nya bernama origin.');
      const b = pos[1] || s.head.branch;
      if (!b) return fail('fatal: You are not currently on a branch.');
      if (!pos[0] && !s.upstream[b]) return fail('fatal: The current branch ' + b + ' has no upstream branch.', 'Pertama kali, pakai: git push -u origin ' + b);
      const local = s.branches[b];
      if (!local) return fail('error: src refspec ' + b + ' does not match any', 'Branch itu belum punya commit atau namanya salah. Cek: git branch');
      const remote = s.hub.branches[b];
      if (remote === local) {
        if (setUp) s.upstream[b] = 'origin/' + b;
        s.tracking['origin/' + b] = local;
        return ok('push', 'Everything up-to-date', hint('Remote sudah sama dengan lokalmu.'));
      }
      if (remote && !this.ancestors(local).has(remote)) {
        return fail(['To ' + s.remoteUrl, ' ! [rejected]        ' + b + ' -> ' + b + ' (fetch first)', "error: failed to push some refs to '" + s.remoteUrl + "'"], 'Remote punya commit yang belum kamu punya. Jalankan git pull dulu, baru push lagi.', 'push-rejected');
      }
      s.hub.branches[b] = local;
      s.tracking['origin/' + b] = local;
      const out = ['To ' + s.remoteUrl, remote ? '   ' + remote + '..' + local + '  ' + b + ' -> ' + b : ' * [new branch]      ' + b + ' -> ' + b];
      if (setUp) {
        s.upstream[b] = 'origin/' + b;
        out.push("branch '" + b + "' set up to track 'origin/" + b + "'.");
      }
      out.push(hint('Commitmu terkirim ke remote (lihat panel Remote). Setelah -u, cukup ketik git push / git pull.'));
      return ok('push', out);
    }

    pull(args) {
      const s = this.s;
      const pos = args.filter((a) => !a.startsWith('-'));
      if (!s.remoteUrl) return this.noRemote();
      const b = pos[1] || s.head.branch;
      if (!b) return fail('You are not currently on a branch.');
      if (!pos[0] && !s.upstream[b]) return fail('There is no tracking information for the current branch.', 'Pakai: git pull origin ' + b + '  atau set dulu dengan: git push -u origin ' + b);
      const fetched = this.doFetch();
      const out = fetched.length ? ['From ' + s.remoteUrl].concat(fetched) : [];
      const target = s.tracking['origin/' + b];
      if (!target) return fail("fatal: couldn't find remote ref " + b, 'Remote belum punya branch itu.');
      if (!this.headId()) {
        this.setHead(target);
        this.applyFiles(this.commitFiles(target));
        return ok('pull', out, 'Fast-forward');
      }
      const m = this.merge(['origin/' + b], "Merge branch '" + b + "' of " + s.remoteUrl);
      if (!m.ok) return m;
      return { ok: true, key: 'pull', lines: flat(out).concat(m.lines) };
    }

    clone(args) {
      const s = this.s;
      if (!args[0]) return fail('fatal: You must specify a repository to clone.', 'Contoh: git clone https://github.com/kamu/proyek.git');
      if (s.inited || Object.keys(s.work).length) return fail("fatal: destination path '.' already exists and is not an empty directory.", "Clone butuh folder kosong. Klik 'Hapus folder lokal' dulu.");
      s.inited = true;
      s.remoteUrl = args[0];
      const out = ["Cloning into 'proyek'..."];
      const names = Object.keys(s.hub.branches);
      if (!names.length) return ok('clone', out, 'warning: You appear to have cloned an empty repository.', hint('Remote masih kosong, jadi tidak ada yang diunduh.'));
      names.forEach((b) => (s.tracking['origin/' + b] = s.hub.branches[b]));
      const def = s.hub.branches.main ? 'main' : names[0];
      s.branches[def] = s.hub.branches[def];
      s.head = { branch: def, id: null };
      s.upstream[def] = 'origin/' + def;
      this.applyFiles(this.commitFiles(s.branches[def]));
      return ok('clone', out, 'done.', hint('Semua riwayat dan file diunduh, dan remote origin sudah terhubung otomatis.'));
    }

    /* autocomplete ala Tab di shell: kembalikan {cur, cands} */
    complete(buf) {
      const s = this.s;
      if ((buf.match(/["']/g) || []).length % 2) return { cur: '', cands: [] };
      const parts = buf.replace(/^\s+/, '').split(/\s+/);
      const cur = parts[parts.length - 1];
      const prev = parts.slice(0, -1);
      const dash = cur.startsWith('-');
      const files = () => {
        const set = new Set(Object.keys(s.work));
        this.changes().unstaged.forEach(([n]) => set.add(n));
        return [...set];
      };
      const branches = () => Object.keys(s.branches);
      const refs = () => ['HEAD', 'HEAD~1'].concat(branches(), Object.keys(s.tracking));
      const pick = (list, flags) => (dash ? flags || [] : list);
      let list = [];
      if (!prev.length) list = ['git', 'touch', 'edit', 'rm', 'ls', 'clear', 'help'];
      else if (prev[0] === 'git') {
        const sub = prev[1];
        const args = prev.slice(2);
        if (prev.length === 1) {
          list = ['init', 'status', 'add', 'commit', 'log', 'diff', 'branch', 'checkout', 'switch', 'merge', 'reset', 'restore', 'remote', 'push', 'fetch', 'pull', 'clone', 'help'];
        } else if (sub === 'add') list = pick(files().concat(['.']));
        else if (sub === 'commit') list = pick([], ['-m', '-a', '-am']);
        else if (sub === 'log') list = pick([], ['--oneline']);
        else if (sub === 'diff') list = pick([], ['--staged']);
        else if (sub === 'reset') list = pick(refs(), ['--soft', '--mixed', '--hard']);
        else if (sub === 'restore') list = pick(files(), ['--staged']);
        else if (sub === 'branch') list = args[0] === '-d' || args[0] === '-D' ? branches() : pick(branches(), ['-d', '-D']);
        else if (sub === 'checkout') list = args.includes('-b') ? [] : pick(branches(), ['-b']);
        else if (sub === 'switch') list = args.includes('-c') ? [] : pick(branches(), ['-c']);
        else if (sub === 'merge') list = pick(branches().concat(Object.keys(s.tracking)));
        else if (sub === 'remote') list = args[0] === 'add' ? (args.length === 1 ? ['origin'] : []) : args.length ? [] : dash ? ['-v'] : ['add', 'remove', '-v'];
        else if (sub === 'push') list = dash ? ['-u'] : args.filter((a) => !a.startsWith('-')).length === 0 ? ['origin'] : branches();
        else if (sub === 'pull' || sub === 'fetch') list = dash ? [] : args.length === 0 ? ['origin'] : sub === 'pull' ? branches() : [];
      } else if (prev[0] === 'edit' || prev[0] === 'rm') list = prev.length === 1 ? Object.keys(s.work) : [];
      const cands = [...new Set(list)].filter((c) => c.startsWith(cur)).sort();
      return { cur: cur, cands: cands };
    }

    /* simulasi teman push commit ke remote */
    friendCommit() {
      const s = this.s;
      const parent = s.hub.branches.main;
      if (!parent) return fail('Remote masih kosong, teman belum bisa menambah commit.', 'Kirim dulu: git push -u origin main');
      s.friendN += 1;
      const files = Object.assign({}, this.commitFiles(parent));
      const n = 'teman-' + s.friendN + '.txt';
      files[n] = 1;
      const id = this.makeCommit('Teman menambah ' + n, [parent], files);
      s.hub.branches.main = id;
      return ok('friend', '👥 Teman mendorong commit ' + id + ' ke origin/main', hint('Remote maju, tapi komputermu belum tahu. Jalankan: git fetch'));
    }
  }

  global.GitEngine = GitEngine;
  global.GitEngine.tokenize = tokenize;
})(window);
