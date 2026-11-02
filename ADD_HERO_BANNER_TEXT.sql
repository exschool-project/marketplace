-- ---------------------------------------------------------------------
-- Tambahan: kolom judul & sub-judul untuk banner gambar (hero_banners).
-- Dipakai buat menimpa teks di atas gambar banner secara otomatis,
-- bukan diedit manual di file gambarnya.
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali, tidak akan error kalau kolom sudah ada).
-- ---------------------------------------------------------------------
alter table public.hero_banners
  add column if not exists title text,
  add column if not exists subtitle text;
