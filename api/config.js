module.exports = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: 'Konfigurasi Supabase belum diatur di environment variables.' });
    return;
  }

  // anon key aman dikirim ke browser — akses datanya dibatasi oleh RLS,
  // dipakai di admin.html hanya untuk proses login (Supabase Auth)
  res.status(200).json({ supabaseUrl, supabaseAnonKey });
};
