-- ---------------------------------------------------------------------
-- Tambahan: role baru 'cs' (Customer Service) di tabel profiles.
--
-- Role ini cuma bisa: login ke cs.html, lihat & balas chat pesanan,
-- ubah status transaksi. TIDAK bisa kelola produk/kategori/banner/tim
-- (itu tetap khusus admin & owner) — penegakannya di server, lihat
-- api/_lib/auth.js (ROLE_LEVEL: member < cs < admin < owner).
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali).
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('member', 'cs', 'admin', 'owner'));

-- Setelah ini, angkat akun CS pertama dari panel Manajemen Tim
-- (admin.html, khusus owner) — pilih role "CS" di dropdown akun yang
-- dituju. Atau langsung lewat SQL:
-- update public.profiles set role = 'cs' where id = (select id from auth.users where email = 'cs@email.com');
