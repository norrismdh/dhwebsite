/* ─── DH DOWNLOADS MODULE ────────────────────────────────────────────────────
 * GET /api/releases
 * Public endpoint — returns enabled releases sorted newest-first.
 * Internal storage keys (r2Key) are stripped from the response.
 * ─────────────────────────────────────────────────────────────────────────── */

import { getReleases } from './_r2.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = await getReleases();

    const releases = (data.releases ?? [])
      .filter(r => r.enabled)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .map(({ id, type, version, title, notes, publishedAt, files }) => ({
        id,
        type,
        version,
        title,
        notes,
        publishedAt,
        // Strip r2Key — browsers only need the public fileId to build download URLs
        files: Object.fromEntries(
          Object.entries(files ?? {}).map(([os, f]) => [
            os,
            {
              fileId:        f.fileId,
              filename:      f.filename,
              sizeBytes:     f.sizeBytes,
              downloadCount: f.downloadCount ?? 0,
            },
          ]),
        ),
      }));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ releases });
  } catch (err) {
    console.error('releases error:', err.message);
    return res.status(500).json({ error: 'Failed to load releases' });
  }
}
