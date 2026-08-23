-- ---------------------------------------------------------------------
-- Tambahan: kolom kontak opsional di tabel profiles, dipakai halaman
-- Profil (akun.html) — user bisa isi nomor WhatsApp & kontak lain
-- (Instagram/Telegram/dll) secara opsional, di luar email akun.
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali).
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists other_contact text;

comment on column public.profiles.phone is 'Nomor WhatsApp, opsional, diisi sendiri oleh user lewat halaman Profil.';
comment on column public.profiles.other_contact is 'Kontak tambahan opsional (Instagram/Telegram/dll), diisi sendiri oleh user lewat halaman Profil.';
