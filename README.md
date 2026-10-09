# Git Visualizer

Simulator git interaktif untuk pemula. Ketik command git di terminal, lalu lihat file berpindah antara
Working Directory, Staging Area, dan Repository, serta commit graph yang tergambar otomatis.

Murni HTML + CSS + JavaScript (tanpa build, tanpa dependency). Git disimulasikan di browser, bukan git asli.

## Jalankan lokal

Buka `index.html` di browser, atau:

```sh
python3 -m http.server 8000
```

## Deploy ke GitHub Pages

1. Push folder ini ke repository GitHub.
2. Settings → Pages → Source: `Deploy from a branch`, pilih `main` dan folder `/ (root)`.
3. Bagikan link `https://<username>.github.io/<repo>/` ke murid.

## Command yang didukung

`git init`, `status`, `add`, `commit` (`-m`, `-a`), `log` (`--oneline`), `diff` (`--staged`), `branch`,
`checkout` (`-b`), `switch` (`-c`), `merge`, `reset` (`--soft/--mixed/--hard`), `restore` (`--staged`).
Remote simulasi (GitHub): `remote add origin`, `push` (`-u`), `fetch`, `pull`, `clone`. Tombol "Teman push commit" mensimulasikan teman yang mengirim commit ke remote, dan "Hapus folder lokal" untuk latihan `clone`.
Pembantu: `touch`, `edit`, `rm`, `ls`, `clear`, `help`.

Batasan: konflik merge tidak disimulasikan, hanya satu remote (`origin`) yang disimulasikan di memori, bukan koneksi sungguhan.

## Mengubah ukuran kotak

Di layar lebar, garis pemisah antar kotak bisa diseret (panel misi, zona file, graf lokal/remote, terminal).
Bisa juga lewat keyboard (fokus ke garis dengan Tab, lalu tombol panah, Shift = lompat lebih besar).
Klik dua kali pada garis untuk mengembalikan ukurannya, atau pakai tombol "Reset tata letak".
Ukuran disimpan di browser masing-masing murid (localStorage).
