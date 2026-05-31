let cachedSignToken    = null;
let signTokenExpiresAt = 0;
let cachedTemplateActionId = null;

async function getTemplateActionId(token) {
  if (cachedTemplateActionId) return cachedTemplateActionId;

  const signHeaders = {
    Authorization: `Zoho-oauthtoken ${token}`,
    ...(process.env.ZOHO_SIGN_ORG_ID ? { 'X-ZS-ORGID': process.env.ZOHO_SIGN_ORG_ID } : {}),
  };

  const res  = await fetch(
    `https://sign.zoho.com/api/v1/templates/${process.env.ZOHO_SIGN_TEMPLATE_ID}`,
    { headers: signHeaders }
  );
  const data = await res.json();
  console.log('Zoho Sign template response:', JSON.stringify(data));

  const actionId = data?.templates?.actions?.[0]?.action_id;
  if (!actionId) throw new Error('Could not read action_id from Zoho Sign template');

  cachedTemplateActionId = actionId;
  return actionId;
}

async function getSignToken() {
  const now = Date.now();
  if (cachedSignToken && now < signTokenExpiresAt) return cachedSignToken;

  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.ZOHO_SIGN_CLIENT_ID,
      client_secret: process.env.ZOHO_SIGN_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_SIGN_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    console.error('Zoho Sign token error:', JSON.stringify(data));
    throw new Error('Could not obtain Zoho Sign access token');
  }

  cachedSignToken    = data.access_token;
  signTokenExpiresAt = now + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedSignToken;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fullName, title, company, entityType, address, email, website } = req.body ?? {};

  // Honeypot — bots fill this hidden field, humans don't
  if (website) return res.status(200).json({ success: true });

  if (!fullName?.trim() || !company?.trim() || !email?.trim() || !address?.trim()) {
    return res.status(400).json({ error: 'All required fields must be completed.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const token     = await getSignToken();
    const firstName = fullName.trim().split(/\s+/)[0];
    const baseUrl   = process.env.SITE_URL || `https://${process.env.VERCEL_URL}`;
    const redirectUrl = `${baseUrl}/nda-signed.html?name=${encodeURIComponent(firstName)}&email=${encodeURIComponent(email.trim())}`;

    // Fetch the template's action_id (required by Zoho Sign API, cached after first call)
    const templateActionId = await getTemplateActionId(token);

    // Step 1 — create document from template
    // Field names must match the labels set in the Zoho Sign template
    const signHeaders = {
      Authorization:  `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json',
      ...(process.env.ZOHO_SIGN_ORG_ID ? { 'X-ZS-ORGID': process.env.ZOHO_SIGN_ORG_ID } : {}),
    };

    const createRes = await fetch(
      `https://sign.zoho.com/api/v1/templates/${process.env.ZOHO_SIGN_TEMPLATE_ID}/createdocument`,
      {
        method:  'POST',
        headers: signHeaders,
        body: JSON.stringify({
          templates: {
            field_data: {
              field_text_data: {
                'Company':   company.trim(),
                'Text - 1':  entityType?.trim() || '',
                'Text - 2':  address.trim(),
              },
            },
            actions: [{
              action_id:       templateActionId,
              action_type:     'SIGN',
              recipient_name:  fullName.trim(),
              recipient_email: email.trim(),
              role:            'Counterparty',
              signing_order:   1,
              private_notes:   'Please review and sign the Digital Hive Non-Disclosure Agreement.',
              redirect_url:    redirectUrl,
            }],
          },
        }),
      }
    );

    const createData = await createRes.json();
    console.log('Zoho Sign create response:', JSON.stringify(createData));

    const requestId = createData?.requests?.request_id;
    const action    = createData?.requests?.actions?.[0];
    const actionId  = action?.action_id;

    if (!requestId) {
      console.error('No request_id from Zoho Sign:', JSON.stringify(createData));
      throw new Error('Failed to create signing request');
    }

    // Step 2 — signing URL may be in the create response; if not, fetch it explicitly
    let signingUrl = action?.signing_url ?? action?.sign_url;

    if (!signingUrl && actionId) {
      const urlRes  = await fetch(
        `https://sign.zoho.com/api/v1/requests/${requestId}/embeddedurl?requestsign_signer_id=${actionId}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(process.env.ZOHO_SIGN_ORG_ID ? { 'X-ZS-ORGID': process.env.ZOHO_SIGN_ORG_ID } : {}) } }
      );
      const urlData = await urlRes.json();
      console.log('Zoho Sign embedded URL response:', JSON.stringify(urlData));
      signingUrl = urlData?.sign_url ?? urlData?.signing_url;
    }

    if (!signingUrl) {
      console.error('Could not obtain signing URL. request_id:', requestId, 'action_id:', actionId);
      throw new Error('Signing URL not available');
    }

    return res.status(200).json({ signingUrl });
  } catch (err) {
    console.error('send-nda error:', err.message);
    return res.status(500).json({ error: 'Unable to initiate signing. Please try again or contact us directly.' });
  }
}
