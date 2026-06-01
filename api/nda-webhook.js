let cachedCrmToken    = null;
let crmTokenExpiresAt = 0;

async function getCrmToken() {
  const now = Date.now();
  if (cachedCrmToken && now < crmTokenExpiresAt) return cachedCrmToken;

  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    console.error('Zoho CRM token error:', JSON.stringify(data));
    throw new Error('Could not obtain Zoho CRM access token');
  }

  cachedCrmToken    = data.access_token;
  crmTokenExpiresAt = now + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return cachedCrmToken;
}

// ── Zoho Sign token (separate creds) — needed to read the signed request's fields ──
let cachedSignToken    = null;
let signTokenExpiresAt = 0;

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

// The completion webhook carries no field values — fetch the full request to read them.
async function fetchRequestFields(requestId) {
  try {
    const token = await getSignToken();
    const res   = await fetch(`https://sign.zoho.com/api/v1/requests/${requestId}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(process.env.ZOHO_SIGN_ORG_ID ? { 'X-ZS-ORGID': process.env.ZOHO_SIGN_ORG_ID } : {}),
      },
    });
    const data = await res.json();
    const r    = data?.requests ?? {};
    return [
      ...(r.document_fields ?? []).flatMap(d => d.fields ?? []),
      ...(r.actions ?? []).flatMap(a => Array.isArray(a.fields) ? a.fields : (a.fields?.text_fields ?? [])),
    ];
  } catch (err) {
    console.error('NDA webhook: failed to fetch request fields:', err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // NOTE: do all work BEFORE responding. On Vercel the function can freeze once the
  // response is sent, so awaited CRM calls after res.send() may never run.
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});

    // Zoho Sign wraps the payload under "requests" or "notifications.data"
    const requests  = body.requests ?? body.notifications?.data ?? body;
    const operation = body.notifications?.operation_type;
    const status    = (requests?.request_status ?? requests?.status ?? '').toLowerCase();

    // Zoho fires multiple events (e.g. RequestSigningSuccess AND RequestCompleted), each with
    // status "completed". Only act on the final completion event to avoid duplicate Leads.
    const isCompletion = operation ? operation === 'RequestCompleted' : status === 'completed';
    if (!isCompletion) {
      return res.status(200).json({ received: true, skipped: operation || status });
    }

    const requestId = requests.request_id;
    const actions   = requests.actions ?? [];

    // The real signer is the SIGN action — NOT the "Prefill by you" pseudo-recipient
    // (which Zoho adds with a noreply@zohosign.com address) that may sit at actions[0].
    const signer =
      actions.find(a => a.action_type === 'SIGN' && a.recipient_email && !/zohosign\.com$/i.test(a.recipient_email))
      ?? actions.find(a => a.action_type === 'SIGN')
      ?? actions.find(a => a.role === 'Counterparty')
      ?? actions[0] ?? {};

    // The webhook payload has no field values — fetch the full request and look up by label.
    const fields = await fetchRequestFields(requestId);
    const fieldVal = (...labels) => {
      for (const label of labels) {
        const hit = fields.find(f => f.field_label === label && f.field_value);
        if (hit) return hit.field_value;
      }
      return '';
    };

    // Try our intended labels first, fall back to the template's original labels
    const company  = fieldVal('company_name', 'Company') || 'Unknown Company';
    const entity   = fieldVal('entity_type', 'Text - 1');
    const title    = fieldVal('counterparty_title', 'Job title');

    const recipientEmail = signer.recipient_email ?? signer.signing_email ?? '';
    const recipientName  = signer.recipient_name ?? signer.signing_name ?? fieldVal('counterparty_name', 'Full name');
    const version  = process.env.ZOHO_SIGN_NDA_VERSION ?? '';
    const docLink  = `https://sign.zoho.com/zs#/requests/${requestId}`;
    const signedAt = new Date().toISOString().split('T')[0];

    const ndaBlock = [
      `--- NDA Signed: ${signedAt} ---`,
      `Version: ${version}`,
      `Company: ${company}${entity ? ` (${entity})` : ''}`,
      `Signer: ${recipientName}${title ? `, ${title}` : ''}`,
      `Document: ${docLink}`,
    ].join('\n');

    const crmToken = await getCrmToken();

    // Search for existing Lead by email
    const searchRes = await fetch(
      `https://www.zohoapis.com/crm/v2/Leads/search?criteria=(Email:equals:${encodeURIComponent(recipientEmail)})`,
      { headers: { Authorization: `Zoho-oauthtoken ${crmToken}` } }
    );
    const searchData = await searchRes.json();
    const existingLead = searchData?.data?.[0];

    if (existingLead) {
      const leadId = existingLead.id;

      // Prepend NDA block to existing description
      const existingDesc  = existingLead.Description ?? '';
      const newDesc       = existingDesc ? `${ndaBlock}\n\n${existingDesc}` : ndaBlock;

      await fetch(`https://www.zohoapis.com/crm/v2/Leads/${leadId}`, {
        method:  'PUT',
        headers: {
          Authorization:  `Zoho-oauthtoken ${crmToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: [{ Description: newDesc }] }),
      });

      // Add a Note so the history is preserved across future NDA signings
      await fetch('https://www.zohoapis.com/crm/v2/Notes', {
        method:  'POST',
        headers: {
          Authorization:  `Zoho-oauthtoken ${crmToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: [{
            Note_Title:   `NDA Signed — ${version}`,
            Note_Content: ndaBlock,
            $se_module:   'Leads',
            Parent_Id:    { id: leadId },
          }],
        }),
      });

      console.log('NDA webhook: updated Lead', leadId);
    } else {
      // Create new Lead
      const nameParts = recipientName.trim().split(/\s+/);
      const lastName  = nameParts[nameParts.length - 1] || recipientEmail.split('@')[0];
      const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : '';

      const createRes = await fetch('https://www.zohoapis.com/crm/v2/Leads', {
        method:  'POST',
        headers: {
          Authorization:  `Zoho-oauthtoken ${crmToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: [{
            First_Name:  firstName,
            Last_Name:   lastName,
            Email:       recipientEmail,
            Company:     company,
            Title:       title ?? '',
            Lead_Source: 'NDA Portal',
            Description: ndaBlock,
          }],
        }),
      });
      const createData = await createRes.json();
      const result = createData?.data?.[0];
      if (result?.code !== 'SUCCESS') console.error('NDA webhook: Lead create failed:', JSON.stringify(result ?? createData));
    }

    // TODO: Send email notification to NDA_NOTIFY_EMAIL
    // Requires adding ZohoMail.messages.CREATE scope and ZOHO_MAIL_ACCOUNT_ID env var.
    // Until then, Zoho Sign automatically emails the document owner upon completion.
    console.log(`NDA webhook: completed for ${recipientEmail} (${company})`);

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('nda-webhook error:', err.message);
    // Still 200 so Zoho doesn't retry-storm; the error is logged for us.
    return res.status(200).json({ received: true, error: err.message });
  }
}
