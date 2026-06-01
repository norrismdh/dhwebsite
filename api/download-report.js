import { isBusinessEmail, BUSINESS_EMAIL_MESSAGE } from './_business-email.js';

// Zoho token cache — same pattern as submit-lead.js
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (process.env.ZOHO_ACCESS_TOKEN && process.env.NODE_ENV !== 'production') {
    return process.env.ZOHO_ACCESS_TOKEN;
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) return cachedToken;

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

  cachedToken     = tokenData.access_token;
  tokenExpiresAt  = now + (tokenData.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, company, role } = req.body ?? {};

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!isBusinessEmail(email)) {
    return res.status(400).json({ error: BUSINESS_EMAIL_MESSAGE });
  }

  // Split "First Last" — fall back to email prefix if no name given
  const parts     = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const lastName  = parts[parts.length - 1] || email.split('@')[0];

  try {
    const accessToken = await getAccessToken();

    const leadRes = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{
          First_Name:  firstName,
          Last_Name:   lastName,
          Email:       email,
          Company:     company   ?? '',
          Title:       role      ?? '',
          Lead_Source: 'ISG Download',
          Description: 'Downloaded the ISG Analytics Catalog report from the website.',
        }],
      }),
    });

    const leadData = await leadRes.json();
    console.log('Zoho response:', leadRes.status, JSON.stringify(leadData));
    const result = leadData.data?.[0];

    // SUCCESS or DUPLICATE both get the download — existing contacts are welcome too
    if (result?.code === 'SUCCESS' || result?.code === 'DUPLICATE_DATA') {
      return res.status(200).json({ url: '/assets/reports/ISG-Analytics-Catalog.pdf' });
    }

    console.error('Zoho lead error:', JSON.stringify(result ?? leadData));
    throw new Error(result?.message ?? 'Failed to create lead');
  } catch (err) {
    console.error('download-report error:', err.message);
    return res.status(500).json({ error: 'Submission failed. Please try again.' });
  }
}
