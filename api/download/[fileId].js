/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * GET /downloads/:fileId   (rewritten to /api/download/:fileId by vercel.json)
 *
 * Public endpoint — resolves a permanent share ID to a short-lived R2 signed
 * URL (60 s TTL) and issues a 302 redirect.  The actual bytes flow browser →
 * R2 directly; Vercel is never in the data path.
 *
 * Also increments the per-file download counter in releases.json.
 * Count writes are non-fatal: a storage hiccup will log but not block the
 * download.  At this traffic volume, read-modify-write races are negligible.
 * ─────────────────────────────────────────────────────────────────────────── */

import { getReleases, saveReleases, getSignedDownloadUrl } from '../_r2.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fileId } = req.query;

  if (!fileId) {
    return res.status(400).json({ error: 'Missing file ID' });
  }

  try {
    const data = await getReleases();

    // Walk all releases and all OS entries to find the matching fileId
    let foundRelease = null;
    let foundOs      = null;
    let foundFile    = null;

    outer: for (const release of data.releases ?? []) {
      for (const [os, file] of Object.entries(release.files ?? {})) {
        if (file.fileId === fileId) {
          foundRelease = release;
          foundOs      = os;
          foundFile    = file;
          break outer;
        }
      }
    }

    // Return the same 404 whether the ID never existed or has been disabled —
    // no need to reveal which state it's in.
    if (!foundFile || !foundRelease || !foundRelease.enabled) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Generate the ephemeral download URL first so a count-write failure
    // never prevents the download from starting.
    const signedUrl = await getSignedDownloadUrl(foundFile.r2Key, foundFile.filename);

    // Increment download counter — best-effort, non-fatal
    try {
      foundRelease.files[foundOs].downloadCount =
        (foundFile.downloadCount ?? 0) + 1;
      await saveReleases(data);
    } catch (countErr) {
      console.error(`download count update failed [${fileId}]:`, countErr.message);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, signedUrl);
  } catch (err) {
    console.error(`download error [${fileId}]:`, err.message);
    return res.status(500).json({ error: 'Download unavailable. Please try again.' });
  }
}
