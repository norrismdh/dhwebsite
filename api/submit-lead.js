import { isBusinessEmail, BUSINESS_EMAIL_MESSAGE } from './_business-email.js';

// Cache the access token for the lifetime of the function instance.
// Zoho tokens are valid for 3600s; we refresh 5 minutes early to be safe.
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // ZOHO_ACCESS_TOKEN in .env.local lets dev skip the rate-limited token endpoint.
  // Explicitly disabled in production — pre-seeded tokens expire after 1 hour.
  if (process.env.ZOHO_ACCESS_TOKEN && process.env.NODE_ENV !== 'production') {
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

  const { firstName, lastName, email, company, jobTitle, role, topic, biTools, website, partnerType, region, message, leadSource, utm } = req.body ?? {};

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!isBusinessEmail(email)) {
    return res.status(400).json({ error: BUSINESS_EMAIL_MESSAGE });
  }

  // Accept a bare domain (e.g. "yourfirm.com") and add a scheme so the CRM
  // stores a clickable URL.
  const normalizedWebsite = (() => {
    const w = (website ?? '').trim();
    if (!w) return '';
    return /^https?:\/\//i.test(w) ? w : `https://${w}`;
  })();

  try {
    const accessToken = await getAccessToken();

    // Human-friendly labels for the raw utm_* keys the tracker sends.
    const UTM_LABELS = {
      utm_source:   'Source',
      utm_medium:   'Medium',
      utm_campaign: 'Campaign',
      utm_term:     'Term',
      utm_content:  'Content',
      gclid:        'Google Click ID',
    };
    const humanizeKey = (k) =>
      UTM_LABELS[k] ??
      k.replace(/^utm_/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // The lead's job title maps to the native Title field. Fall back to the
    // role category so forms that only capture a role (e.g. pricing) still
    // populate Title as before.
    const leadTitle = (jobTitle && jobTitle.trim()) || role || '';

    // Build the Description as labelled sections, top to bottom, skipping any that are empty.
    // Include Role only when it isn't already serving as the Title, to avoid duplication.
    const detailLines = [
      role && role !== leadTitle && `Role: ${role}`,
      topic && `Enquiry topic: ${topic}`,
      Array.isArray(biTools) && biTools.length && `BI stack: ${biTools.join(', ')}`,
      partnerType && `Partnership type: ${partnerType}`,
      region      && `Primary region: ${region}`,
    ].filter(Boolean);

    const utmLines = utm && typeof utm === 'object'
      ? Object.entries(utm)
          .filter(([, v]) => v)
          .map(([k, v]) => `  ${humanizeKey(k)}: ${v}`)
      : [];

    const sections = [];
    if (detailLines.length)     sections.push(detailLines.join('\n'));
    if (message && message.trim()) sections.push(`Message:\n${message.trim()}`);
    if (utmLines.length)        sections.push(`Campaign attribution:\n${utmLines.join('\n')}`);

    const description = sections.join('\n\n');

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
          Website:     normalizedWebsite,
          Title:       leadTitle,
          Lead_Source: leadSource ?? (utm?.utm_source ? `Website - ${utm.utm_source}` : 'Website Contact'),
          Lead_Status: 'New Suspect',
          Description: description,
        }],
      }),
    });

    const leadData = await leadRes.json();
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
