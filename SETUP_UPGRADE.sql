-- =====================================================================
-- EX-SCHOOL (Yayasan Aqilah Hidayah) — SETUP UPGRADE (role owner, image_url produk)
-- Jalankan seluruh isi file ini di Supabase Dashboard → SQL Editor.
-- Aman dijalankan berulang kali (pakai IF NOT EXISTS / DROP IF EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Izinkan role baru di tabel profiles: 'member', 'admin', 'owner'
-- ---------------------------------------------------------------------
-- Kasus A — kalau kolom "role" pakai CHECK CONSTRAINT (paling umum):
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('member', 'admin', 'owner'));

-- Kasus B — kalau kolom "role" pakai custom ENUM type (jarang dipakai di
-- setup ini, tapi jaga-jaga). Uncomment 2 baris di bawah kalau perlu,
-- ganti "user_role" dengan nama enum kamu yang sebenarnya:
-- alter type user_role add value if not exists 'owner';
-- alter type user_role add value if not exists 'member';

-- Default akun baru (dari /api/auth/register) selalu 'member':
alter table public.profiles alter column role set default 'member';

-- ---------------------------------------------------------------------
-- 2) Tambah kolom image_url di tabel products (untuk foto Cloudinary)
-- ---------------------------------------------------------------------
alter table public.products add column if not exists image_url text;

-- ---------------------------------------------------------------------
-- 2b) Tabel baru: social_links (link medsos di footer, diatur owner)
-- ---------------------------------------------------------------------
create table if not exists public.social_links (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  url text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3) Jadikan akun kamu sebagai OWNER pertama
--    GANTI 'kamu@email.com' dengan email akun yang sudah kamu daftarkan.
-- ---------------------------------------------------------------------
update public.profiles
set role = 'owner'
where id = (select id from auth.users where email = 'kamu@email.com');

-- Cek hasilnya:
select p.id, p.full_name, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.id
order by p.created_at asc;
