-- ---------------------------------------------------------------------
-- Halaman detail produk (produk.html): deskripsi, fitur, galeri foto,
-- contoh/dokumentasi hasil kerja, FAQ, estimasi pengerjaan, dan
-- testimoni yang bisa dikaitkan ke produk tertentu.
--
-- Cara pakai: Supabase → SQL Editor → paste & Run (aman diulang).
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists description   text,
  add column if not exists features      jsonb not null default '[]'::jsonb,  -- ["Revisi 2x", ...]
  add column if not exists gallery       jsonb not null default '[]'::jsonb,  -- ["https://...jpg", ...]
  add column if not exists showcase      jsonb not null default '[]'::jsonb,  -- [{"url":"...","caption":"..."}]
  add column if not exists faq           jsonb not null default '[]'::jsonb,  -- [{"q":"...","a":"..."}]
  add column if not exists delivery_time text;                                -- "2–3 hari kerja"

alter table public.testimonials
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists image_url  text;   -- foto bukti/hasil dari pembeli (opsional)

create index if not exists testimonials_product_idx on public.testimonials(product_id);
