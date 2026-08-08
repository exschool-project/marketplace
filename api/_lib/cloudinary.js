const crypto = require('crypto');

/**
 * Membuat signature untuk "signed upload" ke Cloudinary.
 * Signature dibuat di server (pakai API secret yang tidak pernah
 * dikirim ke browser), lalu dipakai sekali oleh client untuk upload
 * langsung ke Cloudinary tanpa lewat body function Vercel.
 * Lihat: https://cloudinary.com/documentation/signatures
 */
function buildSignature(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

module.exports = { buildSignature, getCloudinaryConfig };
