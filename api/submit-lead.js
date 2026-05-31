// Cache the access token for the lifetime of the function instance.
// Zoho tokens are valid for 3600s; we refresh 5 minutes early to be safe.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  console.log('ZOHO env vars present:', {
    CLIENT_ID:    !!process.env.ZOHO_CLIENT_ID,
    CLIENT_SECRET:!!process.env.ZOHO_CLIENT_SECRET,
    REFRESH_TOKEN:!!process.env.ZOHO_REFRESH_TOKEN,
    ACCESS_TOKEN: !!process.env.ZOHO_ACCESS_TOKEN,
  });

  // ZOHO_ACCESS_TOKEN in .env.local lets dev skip the rate-limited token endpoint.
  // Explicitly disabled in production — pre-seeded tokens expire after 1 hour.
  if (process.env.ZOHO_ACCESS_TOKEN && process.env.NODE_ENV !== 'production') {
    console.log('Using pre-seeded ZOHO_ACCESS_TOKEN (dev only)');
    return process.env.ZOHO_ACCESS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const tokenRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error('Zoho token error:', tokenData);
    throw new Error('Could not obtain Zoho access token');
  }

  cachedToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, lastName, email, company, role, biTools, message, leadSource, utm } = req.body ?? {};

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const accessToken = await getAccessToken();

    const biList = Array.isArray(biTools) && biTools.length
      ? `BI Stack: ${biTools.join(', ')}\n\n`
      : '';

    const utmLines = utm && typeof utm === 'object'
      ? Object.entries(utm)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
      : '';
    const utmBlock = utmLines ? `\n\nCampaign attribution:\n${utmLines}` : '';

    const description = `${biList}${message ?? ''}${utmBlock}`.trim();

    const leadRes = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{
          First_Name:  firstName ?? '',
          Last_Name:   lastName  || email.split('@')[0],
          Email:       email,
          Company:     company   ?? '',
          Title:       role      ?? '',
          Lead_Source: leadSource ?? (utm?.utm_source ? `Website - ${utm.utm_source}` : 'Website'),
          Description: description,
        }],
      }),
    });

    const leadData = await leadRes.json();
    console.log('Zoho response status:', leadRes.status);
    console.log('Zoho response body:', JSON.stringify(leadData));
    const result = leadData.data?.[0];

    if (result?.code === 'SUCCESS') {
      return res.status(200).json({ success: true });
    }

    console.error('Zoho lead error:', JSON.stringify(result ?? leadData));
    throw new Error(result?.message ?? leadData?.message ?? 'Failed to create lead');
  } catch (err) {
    console.error('submit-lead error:', err.message);
    return res.status(500).json({ error: 'Submission failed. Please try again or email us directly.' });
  }
}
