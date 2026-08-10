/**
 * Membungkus handler /api supaya error tak terduga (koneksi Supabase
 * lambat/putus, cold start, bug kecil, dll.) tidak bikin function
 * CRASH TOTAL — yang tadinya balik sebagai halaman error kosong (bukan
 * JSON) dan bikin frontend salah kira sesi login habis lalu paksa logout.
 *
 * Dengan wrapper ini, error apapun tetap dibalikin sebagai JSON yang
 * rapi ({ error: '...' }) dengan status 500, jadi frontend bisa kasih
 * pesan yang jelas dan TIDAK perlu logout paksa.
 */
function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('[api error]', req.url, err);
      if (!res.headersSent) {
        // Tampilkan pesan error ASLI (bukan teks generik) — ini pesan
        // yang kita tulis sendiri di kode (mis. "env var belum diatur",
        // error dari Supabase, dll), aman ditampilkan ke admin/owner
        // supaya penyebabnya langsung kelihatan tanpa perlu buka Vercel Logs.
        res.status(500).json({
          error: (err && err.message) || 'Terjadi gangguan sementara di server. Coba lagi sebentar lagi.',
        });
      }
    }
  };
}

module.exports = { withErrorHandling };
