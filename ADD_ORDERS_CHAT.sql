-- =====================================================================
-- EX-SCHOOL — Sistem Pesanan Langsung + Chat (menggantikan keranjang)
-- Jalankan seluruh isi file ini di Supabase Dashboard → SQL Editor.
-- Aman dijalankan berulang kali (pakai IF NOT EXISTS).
--
-- Alur baru: pembeli klik "Beli Sekarang" di kartu produk -> isi nama +
-- WhatsApp -> sistem bikin 1 baris di `orders` (dapat order_code +
-- access_token) -> pembeli & admin/owner chat di `order_messages` sampai
-- pesanan selesai. Pembeli TIDAK perlu akun (registrasi memang ditutup) —
-- akses pesanannya cukup pakai kombinasi order_code + access_token yang
-- disimpan otomatis di browser mereka (localStorage) dan bisa dimasukkan
-- manual di halaman "Lacak Pesanan" dari device lain.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabel orders — satu baris = satu pesanan
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  access_token uuid not null default gen_random_uuid(),

  product_id uuid references public.products(id) on delete set null,
  product_name text not null,      -- snapshot nama produk saat dipesan
  product_price numeric not null,  -- snapshot harga saat dipesan
  shop_name text,                  -- snapshot nama toko saat dipesan

  buyer_name text not null,
  buyer_phone text not null,       -- nomor WhatsApp pembeli
  buyer_note text,

  status text not null default 'menunggu'
    check (status in ('menunggu', 'diproses', 'dikirim', 'selesai', 'dibatalkan')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_order_code_idx on public.orders (order_code);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ---------------------------------------------------------------------
-- 2) Tabel order_messages — chat per pesanan, antara pembeli & admin/owner
-- ---------------------------------------------------------------------
create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_type text not null check (sender_type in ('buyer', 'admin', 'system')),
  sender_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_messages_order_id_idx on public.order_messages (order_id, created_at asc);

-- ---------------------------------------------------------------------
-- 3) Trigger kecil: auto-update kolom updated_at tiap kali status berubah
-- ---------------------------------------------------------------------
create or replace function public.set_orders_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_orders_updated_at();

-- ---------------------------------------------------------------------
-- Catatan: API (/api/orders.js) selalu pakai SERVICE ROLE KEY di server
-- (lewat getSupabaseAdmin()), jadi RLS di kedua tabel ini boleh tetap
-- default (enabled, tanpa policy publik) — akses publik pembeli DITAHAN
-- & diverifikasi manual di kode API (cocokkan order_code + access_token),
-- bukan lewat Supabase Row Level Security langsung dari browser.
-- ---------------------------------------------------------------------
