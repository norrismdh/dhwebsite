// Serves the public Google Maps JS API key to the browser.
// The key is restricted by HTTP referrer in the Google Cloud Console,
// so exposing it client-side is expected and safe.
export default function handler(req, res) {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!key) return res.status(200).json({ key: '' });

  // Cache at the edge for a day — the key rarely changes.
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
  return res.status(200).json({ key });
}
