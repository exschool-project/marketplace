-- ---------------------------------------------------------------------
-- Tambahan: view orders_with_last_message — dipakai halaman CS
-- (cs.html) supaya daftar percakapan bisa nampilin cuplikan pesan
-- terakhir + diurutkan berdasarkan aktivitas terbaru, tanpa perlu
-- query N+1 dari sisi API.
--
-- Cara pakai: buka Supabase → SQL Editor → paste & jalankan file ini
-- (aman dijalankan berkali-kali).
-- ---------------------------------------------------------------------
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
