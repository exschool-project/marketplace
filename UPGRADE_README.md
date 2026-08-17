# Catatan Upgrade — EX-SCHOOL (Yayasan Aqilah Hidayah)

Ringkasan semua perubahan, dan langkah yang HARUS kamu lakukan sebelum deploy.

## 1. Jalankan SQL di Supabase (wajib, sekali saja)

Buka **Supabase Dashboard → SQL Editor**, copy-paste isi file `SETUP_UPGRADE.sql`,
ganti `kamu@email.com` di bagian bawah dengan email akun yang mau kamu jadikan
**owner** pertama, lalu Run.

Ini akan:
- Mengizinkan role `owner` dan `member` (sebelumnya cuma `admin`)
- Menambah kolom `image_url` di tabel `products`
- Menjadikan akun pilihanmu sebagai owner pertama

> Kalau kamu belum punya akun sama sekali: daftar dulu lewat `akun.html`
> di situs (tab **Daftar**), baru jalankan SQL di atas dengan email tsb.

Selain itu, jalankan juga file `ADD_ORDERS_CHAT.sql` (sekali saja, dengan
cara yang sama) — ini bikin tabel `orders` dan `order_messages` untuk
sistem pesanan + chat yang menggantikan keranjang.

## 2. Set Environment Variables di Vercel

Tambahkan 3 variable baru ini di **Vercel → Project Settings → Environment Variables**
(selain `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` yang
sudah ada sebelumnya):

| Variable | Dari mana ambilnya |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | Cloudinary Dashboard → Account Details → "Cloud name" |
| `CLOUDINARY_API_KEY` | Cloudinary Dashboard → Account Details → "API Key" |
| `CLOUDINARY_API_SECRET` | Cloudinary Dashboard → Account Details → "API Secret" |

API secret **tidak pernah** dikirim ke browser — server yang menandatangani
setiap upload (lihat `api/upload-signature.js`), jadi aman disimpan sebagai
env var biasa.

Setelah menambahkan env var baru, **redeploy** project di Vercel supaya
terbaca oleh functions.

## 3. Apa saja yang berubah

### Role & hak akses
- 3 level role: `member` (pembeli biasa) → `admin` (kelola konten) → `owner` (tertinggi)
- Owner bisa naik/turunkan role akun lain lewat panel **Manajemen Tim**
  (khusus tampil kalau role = owner) di `admin.html`
- Owner terakhir tidak bisa diturunkan rolenya sendiri (proteksi bawaan)
- Semua endpoint API sekarang cek role lewat `requireAdmin` (admin+owner)
  atau `requireOwner` (owner saja)

### Login & Daftar publik
- Halaman baru: **`akun.html`** — tab Masuk & Daftar untuk pembeli biasa
- Akun yang daftar lewat sini otomatis role `member`, TIDAK bisa jadi admin
  sendiri — admin/owner cuma bisa diangkat manual oleh owner
- Setelah login, kalau role-nya admin/owner, muncul tombol "Buka Admin Panel"
  (hanya terlihat oleh yang bersangkutan, tidak ada di halaman publik manapun)

### Admin panel disembunyikan
- Tidak ada lagi link ke `admin.html` di halaman utama (nav & footer sudah
  dibersihkan)
- `admin.html` diberi tag `noindex` + header `X-Robots-Tag` supaya tidak
  diindex Google, dan didaftarkan di `robots.txt`
- **Catatan penting**: ini menyembunyikan panel dari tautan publik & mesin
  pencari, TAPI kalau seseorang tahu persis URL `/admin`, halaman itu tetap
  bisa dibuka (form login tetap muncul) — hanya saja tanpa akun admin/owner
  yang valid, dia tidak akan bisa masuk atau lihat data apapun. Untuk proteksi
  ekstra (misal sembunyikan total dari orang luar), kamu bisa aktifkan
  **Vercel Deployment Protection** atau ganti nama file `admin.html` ke
  path yang cuma kamu tahu.

### Upload gambar produk (Cloudinary)
- Form "Tambah Produk" di admin panel sekarang punya input **Foto produk**
- Alurnya: admin pilih file → browser minta "tiket" upload yang sudah
  ditandatangani ke `/api/upload-signature` → browser upload langsung ke
  Cloudinary (tidak lewat server Vercel, jadi hemat kuota & lebih cepat) →
  URL hasil upload disimpan sebagai `image_url` produk
- Kalau tidak upload gambar, produk tetap bisa pakai ikon/emoji seperti biasa
  (fallback otomatis)

### Bug yang ikut diperbaiki
- `index.html` dan `admin.html` sebelumnya memanggil `styles.css` (dengan "s"),
  padahal nama file aslinya `style.css` — akibatnya styling situs **tidak
  pernah termuat sama sekali**. Sudah diperbaiki jadi `style.css`.

### Sistem keranjang DIHAPUS → diganti Beli Langsung + Chat Pesanan
- Tombol "+ Keranjang" di kartu produk sekarang jadi **"Beli Sekarang"**.
  Klik langsung buka modal isi Nama + No. WhatsApp (tanpa perlu akun/login,
  karena pendaftaran publik memang ditutup).
- Setelah submit, sistem otomatis bikin **kode pesanan** (mis. `EXS-8K4QZ1`)
  + token akses rahasia, disimpan ke tabel `orders`.
- Pembeli langsung diarahkan ke **`pesanan.html`** — halaman ruang chat
  1-lawan-1 dengan admin/owner (tabel `order_messages`), khusus untuk
  pesanan itu. Chat di-refresh otomatis tiap 4 detik (polling, tanpa
  websocket) baik di sisi pembeli maupun admin.
- Kode + token pesanan disimpan otomatis di `localStorage` browser pembeli
  (key `exschool_orders`) supaya gampang dibuka lagi; kalau ganti perangkat,
  pembeli tinggal masukkan manual kode & token di `pesanan.html` (link
  "Lacak Pesanan" di nav & footer).
- Admin panel (`admin.html`) punya panel baru **Pesanan & Chat**: daftar
  semua pesanan, dropdown ubah status (`menunggu` → `diproses` → `dikirim`
  → `selesai`, atau `dibatalkan`), dan tombol **💬 Chat** untuk buka & balas
  percakapan tiap pesanan langsung dari situ.
- 1 endpoint baru saja: `api/orders.js` (menangani pesanan DAN chat
  sekaligus lewat `?resource=messages`, supaya jumlah Vercel Functions
  tetap hemat — sama seperti pola `products.js`).
- Karena belum ada akun multi-toko (semua produk dikelola 1 admin/owner),
  "chat dengan pemilik produk" di sini = chat dengan admin/owner situs.

### Halaman CS khusus (cs.html) — balas chat sampai selesai
- Halaman baru **`cs.html`** (+ `cs.js`), login sama seperti `admin.html`
  (khusus role admin/owner), didaftarkan `noindex` juga di `robots.txt` &
  `vercel.json`.
- Tampilan 2 kolom: kiri daftar semua percakapan (bisa cari & filter per
  status), kanan jendela chat aktif — diurutkan otomatis berdasarkan
  **aktivitas chat terbaru** (bukan cuma tanggal pesanan dibuat), dan
  percakapan yang pesan terakhirnya dari pembeli (belum dibalas admin)
  ditandai kuning muda.
- Status pesanan bisa langsung diubah dari dropdown di header chat —
  jadi admin bisa bales sampai status `selesai` tanpa pindah halaman.
- Ada link "💬 CS Panel" di header `admin.html`, dan sebaliknya link
  "Admin Panel" di header `cs.html`, biar gampang bolak-balik.
- Butuh 1 SQL tambahan: **`ADD_ORDERS_LAST_MESSAGE.sql`** — bikin view
  `orders_with_last_message` (cuplikan pesan terakhir per pesanan, dipakai
  daftar percakapan di CS Panel).

## 4. File baru yang ditambahkan

```
akun.html, akun.js              → halaman login/daftar publik
robots.txt                      → blokir crawler dari /admin
SETUP_UPGRADE.sql               → migrasi database (jalankan sekali)
ADD_ORDERS_CHAT.sql             → migrasi tabel orders + order_messages
ADD_ORDERS_LAST_MESSAGE.sql     → view orders_with_last_message (buat CS Panel)
api/orders.js                   → API pesanan + chat (publik & admin)
pesanan.html, pesanan.js        → ruang chat pesanan untuk pembeli
cs.html, cs.js                  → CS Panel — balas chat pembeli sampai selesai
api/_lib/cloudinary.js          → helper signed upload
api/upload-signature.js         → endpoint pembuat tiket upload
api/auth/register.js            → daftar akun publik (role member)
api/auth/profile.js             → profil untuk semua role (dipakai akun.html)
api/admin/users/index.js        → (owner) list semua akun
api/admin/users/[id].js         → (owner) ubah role akun
```

## 5. Alur peran singkat

1. Pembeli daftar/login lewat `akun.html` → role `member`
2. Owner login ke `admin.html` → buka panel **Manajemen Tim** → naikkan
   role akun tertentu jadi `admin` (atau `owner` lain kalau perlu)
3. Admin login ke `admin.html` → kelola banner/kategori/produk, TIDAK
   melihat panel Manajemen Tim (hanya owner yang bisa)
4. Semua pengecekan role dilakukan di server (`_lib/auth.js`), bukan cuma
   disembunyikan di sisi tampilan — jadi aman dari akses langsung ke API
