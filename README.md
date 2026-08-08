# Pasarin — Marketplace Neobrutalism

Homepage statis (HTML/CSS/JS murni, tanpa data demo) + admin panel, semua data
disimpan di **Supabase** dan diakses lewat folder **`/api`** (Vercel Serverless
Functions). Hanya akun dengan `role = admin` yang bisa membuka dashboard admin.

## Struktur proyek

```
├── index.html          Halaman utama (fetch semua data dari /api)
├── admin.html           Halaman admin: login + dashboard CRUD
├── styles.css            Style homepage (neobrutalism)
├── admin.css             Style tambahan khusus admin
├── script.js             Logika homepage: render banner, kategori, produk
├── admin.js              Logika admin: login, verifikasi role, CRUD
├── api/
│   ├── config.js          GET  — kirim SUPABASE_URL + anon key ke browser (untuk login)
│   ├── auth/me.js          GET  — cek sesi & role user yang sedang login
│   ├── banner/index.js     GET/POST     pesan banner
│   ├── banner/[id].js      PUT/DELETE   pesan banner
│   ├── categories/index.js GET/POST     kategori
│   ├── categories/[id].js  PUT/DELETE   kategori
│   ├── products/index.js   GET/POST     produk
│   ├── products/[id].js    GET/PUT/DELETE produk
│   └── _lib/               helper internal (tidak jadi route)
├── sql/schema.sql        Skema tabel + Row Level Security
└── .env.example           Daftar environment variables yang dibutuhkan
```

## 1. Setup Supabase

1. Buat project baru di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, tempel isi `sql/schema.sql`, lalu jalankan (RUN).
   Ini membuat tabel `profiles`, `categories`, `products`, `banner_messages`
   beserta Row Level Security-nya.
3. Buka **Authentication > Providers**, pastikan **Email** aktif.
4. Buka **Authentication > Users**, klik **Add user** (atau daftar lewat
   halaman admin nanti) untuk membuat akun pertamamu.
5. Jadikan akun itu admin — di **SQL Editor** jalankan:
   ```sql
   update public.profiles
   set role = 'admin'
   where id = '<user-id-dari-Authentication>Users>';
   ```
   Akun lain yang daftar otomatis mendapat `role = 'customer'` dan tidak bisa
   masuk ke admin panel.
6. Ambil tiga nilai berikut dari **Project Settings > API**:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ rahasia)

## 2. Environment variables

Salin `.env.example` ke `.env` untuk pengembangan lokal, isi tiga nilai di
atas. Untuk produksi, isi nilai yang sama di **Vercel > Project Settings >
Environment Variables**.

## 3. Push ke GitHub & deploy ke Vercel

```bash
git init
git add .
git commit -m "Pasarin marketplace"
git branch -M main
git remote add origin <url-repo-github-kamu>
git push -u origin main
```

Lalu di [vercel.com](https://vercel.com):
1. **Add New Project** → import repo GitHub ini.
2. Isi tiga environment variables di atas.
3. Deploy. Vercel otomatis mendeteksi folder `/api` sebagai Serverless
   Functions dan menyajikan `index.html`, `admin.html`, dll. sebagai file
   statis.
4. Berkat `vercel.json` (`cleanUrls`), admin panel bisa diakses lewat
   `/admin` maupun `/admin.html`.

## 4. Cara kerja akses admin

- Login di `admin.html` memakai Supabase Auth (email + password) langsung
  dari browser.
- Setelah login, browser memanggil `GET /api/auth/me` sambil membawa token
  sesi. Endpoint ini memverifikasi token ke Supabase lalu mengecek kolom
  `role` di tabel `profiles`.
- Kalau `role !== 'admin'`, server membalas `403` dan browser otomatis
  sign-out serta menampilkan pesan "bukan admin" — dashboard tidak pernah
  dirender.
- Semua endpoint tulis (`POST`/`PUT`/`DELETE`) di `/api/banner`,
  `/api/categories`, `/api/products` melakukan pengecekan role yang sama di
  server, jadi permintaan langsung ke API pun tetap ditolak kalau bukan admin.
- `SUPABASE_SERVICE_ROLE_KEY` (kunci yang bisa menulis ke database) hanya
  hidup di server (`/api`) dan **tidak pernah** dikirim ke browser.

## 5. Menambah data lewat admin panel

Buka `/admin`, login dengan akun admin, lalu:
- **Banner** — tambah/nonaktifkan/hapus pesan yang berjalan di pita atas.
- **Kategori** — tambah kategori (slug dibuat otomatis dari nama), hapus.
- **Produk** — isi form (nama, toko, harga, ikon/emoji, kategori, label),
  produk langsung tampil di grid halaman utama.

Halaman utama (`/`) tidak punya data bawaan — kalau tabel masih kosong, area
banner disembunyikan dan grid produk menampilkan pesan "Belum ada produk".
