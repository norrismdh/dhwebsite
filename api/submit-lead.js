export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { firstName, lastName, email, company, role, biTools, message } = req.body ?? {};

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
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

    const biList = Array.isArray(biTools) && biTools.length
      ? `BI Stack: ${biTools.join(', ')}\n\n`
      : '';
    const description = `${biList}${message ?? ''}`.trim();

    const leadRes = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
      method: 'POST',
      headers: {
        Authorization:  `Zoho-oauthtoken ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{
          First_Name:  firstName ?? '',
          Last_Name:   lastName  || email.split('@')[0],
          Email:       email,
          Company:     company   ?? '',
          Title:       role      ?? '',
          Lead_Source: 'Website',
          Description: description,
        }],
      }),
    });

    const leadData = await leadRes.json();
    const result = leadData.data?.[0];

    if (result?.code === 'SUCCESS') {
      return res.status(200).json({ success: true });
    }

    console.error('Zoho lead error:', result);
    throw new Error(result?.message ?? 'Failed to create lead');
  } catch (err) {
    console.error('submit-lead error:', err.message);
    return res.status(500).json({ error: 'Submission failed. Please try again or email us directly.' });
  }
}
