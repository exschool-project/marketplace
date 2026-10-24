-- ---------------------------------------------------------------------
-- Pilihan / varian produk (mis. Kapasitas, Warna, Paket) + jumlah beli
-- di halaman beli (beli.html). Pilihan diisi admin per produk.
--
-- Cara pakai: Supabase → SQL Editor → paste & Run (aman diulang).
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists options jsonb not null default '[]'::jsonb;
  -- [{"name":"Kapasitas","values":[{"label":"256GB","price_add":0,"sold_out":false}]}]

alter table public.orders
  add column if not exists quantity int not null default 1,
  add column if not exists selected_options jsonb not null default '[]'::jsonb;
  -- [{"group":"Kapasitas","label":"256GB"}]

-- Supaya kolom baru ikut tampil di view CS Panel, buat ulang view-nya:
create or replace view public.orders_with_last_message as
select
  o.*,
  lm.message as last_message,
  lm.sender_type as last_sender_type,
  lm.created_at as last_message_at
from public.orders o
left join lateral (
  select m.message, m.sender_type, m.created_at
  from public.order_messages m
  where m.order_id = o.id
  order by m.created_at desc
  limit 1
) lm on true;
