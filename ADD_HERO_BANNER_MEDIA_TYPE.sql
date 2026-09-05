-- ---------------------------------------------------------------------
-- Tambahan: kolom media_type di hero_banners, supaya Banner Gambar di
-- beranda bisa berupa GAMBAR atau VIDEO (sebelumnya cuma gambar).
-- Kolom image_url TETAP dipakai buat menyimpan URL-nya, apa pun jenis
-- medianya — media_type ('image' / 'video') yang menentukan cara
-- render-nya di frontend (<img> vs <video>).
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali, tidak akan error kalau kolom sudah ada).
-- ---------------------------------------------------------------------
alter table public.hero_banners
  add column if not exists media_type text not null default 'image';

alter table public.hero_banners
  drop constraint if exists hero_banners_media_type_check;

alter table public.hero_banners
  add constraint hero_banners_media_type_check check (media_type in ('image', 'video'));
