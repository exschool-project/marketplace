-- ---------------------------------------------------------------------
-- Tambahan: kolom user_id di tabel orders — dipakai fitur "Riwayat
-- Pesanan otomatis". Kalau pembeli checkout SAMBIL login, pesanannya
-- ditandai punya akun itu, jadi lain kali dia buka pesanan.html dalam
-- keadaan login, semua pesanannya langsung muncul tanpa perlu ketik
-- kode + token manual.
--
-- Checkout TANPA login tetap didukung penuh seperti sebelumnya (kode +
-- token akses) — kolom ini nullable, cuma keisi kalau pembelinya login.
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali).
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists orders_user_id_idx on public.orders(user_id);

comment on column public.orders.user_id is 'Diisi otomatis kalau pembeli login pas checkout. NULL kalau checkout sebagai tamu (guest).';
