-- ---------------------------------------------------------------------
-- Tabel baru: testimonials — ulasan/testimoni pembeli yang ditampilkan
-- di beranda. Dikelola lewat Admin Panel (admin/owner), BUKAN diisi
-- placeholder/demo — kalau tabelnya masih kosong, beranda otomatis
-- nyembunyiin section testimoni sampai ada testimoni asli yang ditambahin.
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali).
-- ---------------------------------------------------------------------
create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  author_role text,              -- opsional: kota/profesi/nama produk yang dibeli, dst
  quote text not null,
  rating smallint not null default 5 check (rating between 1 and 5),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists testimonials_active_sort_idx on public.testimonials(is_active, sort_order);
