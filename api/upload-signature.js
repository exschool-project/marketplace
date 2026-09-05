const { requireAdmin } = require('./_lib/auth');
const { buildSignature, getCloudinaryConfig } = require('./_lib/cloudinary');
const { withErrorHandling } = require('./_lib/http');

// Endpoint ini HANYA membuat "tiket" upload yang sudah ditandatangani.
// File gambar sendiri tidak lewat server ini — browser admin upload
// langsung ke Cloudinary pakai tiket ini (lebih cepat & hemat kuota function).
module.exports = withErrorHandling(async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const config = getCloudinaryConfig();
  if (!config) {
    res.status(500).json({
      error: 'Cloudinary belum dikonfigurasi. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, dan CLOUDINARY_API_SECRET di environment variables.',
    });
    return;
  }

  const rawFolder = (req.body && req.body.folder) || 'ex-school/products';
  const folder = String(rawFolder).replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 100) || 'ex-school/products';

  // resource_type nentuin endpoint Cloudinary yang dipakai (image/upload
  // vs video/upload) — dikirim dari client sesuai jenis file yang dipilih
  // (foto atau video). Tidak ikut ditandatangani karena bukan parameter
  // yang dikirim ke Cloudinary, cuma dipakai buat susun uploadUrl di sini.
  const rawResourceType = (req.body && req.body.resourceType) || 'image';
  const resourceType = rawResourceType === 'video' ? 'video' : 'image';

  const timestamp = Math.round(Date.now() / 1000);
  const signature = buildSignature({ timestamp, folder }, config.apiSecret);

  res.status(200).json({
    timestamp,
    signature,
    apiKey: config.apiKey,
    cloudName: config.cloudName,
    folder,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/upload`,
  });
});
