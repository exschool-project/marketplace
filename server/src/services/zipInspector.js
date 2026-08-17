import AdmZip from 'adm-zip';
import { isSafeRelativePath } from './uploadSecurity.js';

// A ratio above this (uncompressed / compressed), only checked once the
// entry is already reasonably large, flags a likely zip bomb without
// tripping on ordinary small, highly-compressible text files (which can
// legitimately hit 20-50x).
const SUSPICIOUS_RATIO = 100;
const SUSPICIOUS_RATIO_MIN_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Reads ZIP metadata (NOT the decompressed content) for every entry and
 * validates it against every limit before anything is extracted. Throws
 * on the first violation — callers should treat any thrown error as
 * "reject the whole upload", not "skip this one entry".
 *
 * ⚠️ Honest caveat: the symlink check below relies on reading unix mode
 * bits out of adm-zip's `entry.header.attr` field. This matches the
 * standard ZIP external-attributes convention (unix mode stored in the
 * high 16 bits), but I have not been able to verify it against a
 * real symlink-containing ZIP in this sandbox (no network/build tools to
 * craft and test one). Treat it as defense-in-depth, not a guarantee —
 * test with a deliberately crafted symlink ZIP before trusting this in
 * production, and don't rely on it as the only protection (the app also
 * never executes anything from an uploaded repo, which is the bigger
 * mitigation for symlink-based attacks).
 */
export function inspectZip(buffer, { maxFiles, maxExtractedSize, maxFileSize }) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Not a valid ZIP file, or it is corrupted.');
  }

  const entries = zip.getEntries();

  const fileEntries = entries.filter((e) => !e.isDirectory);
  if (fileEntries.length > maxFiles) {
    throw new Error(`ZIP contains ${fileEntries.length} files, which exceeds the limit of ${maxFiles}.`);
  }

  let totalUncompressed = 0;
  const safeEntries = [];

  for (const entry of fileEntries) {
    const name = entry.entryName;

    if (!isSafeRelativePath(name)) {
      throw new Error(`Unsafe path in ZIP: "${name}" — looks like a path traversal attempt. Whole upload rejected.`);
    }

    // Best-effort symlink rejection — see caveat in the function doc above.
    const unixMode = (entry.header.attr >>> 16) & 0xf000;
    const S_IFLNK = 0xa000;
    if (unixMode === S_IFLNK) {
      throw new Error(`ZIP entry "${name}" appears to be a symlink — rejected.`);
    }

    const uncompressed = entry.header.size;
    const compressed = Math.max(entry.header.compressedSize, 1);

    if (maxFileSize && uncompressed > maxFileSize) {
      throw new Error(`"${name}" is ${(uncompressed / 1_048_576).toFixed(2)}MB, which exceeds the ${(maxFileSize / 1_048_576).toFixed(0)}MB per-file limit.`);
    }

    totalUncompressed += uncompressed;
    if (totalUncompressed > maxExtractedSize) {
      throw new Error(
        `Total extracted size exceeds the ${(maxExtractedSize / 1_000_000).toFixed(0)}MB limit — rejected (possible zip bomb).`
      );
    }

    const ratio = uncompressed / compressed;
    if (uncompressed > SUSPICIOUS_RATIO_MIN_SIZE && ratio > SUSPICIOUS_RATIO) {
      throw new Error(
        `"${name}" has a suspicious compression ratio (${ratio.toFixed(0)}x) — rejected as a likely zip bomb.`
      );
    }

    safeEntries.push({ path: name, size: uncompressed, entry });
  }

  return { safeEntries, totalUncompressed };
}

/** Decompresses one already-validated entry into a Buffer. */
export function readZipEntry(entryRef) {
  return entryRef.entry.getData();
}
