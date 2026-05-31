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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Always acknowledge Zoho Sign immediately to prevent retries
  res.status(200).json({ received: true });

  try {
    const body = req.body ?? {};

    // Zoho Sign wraps the payload under "requests" or "notifications.data"
    const requests = body.requests ?? body.notifications?.data ?? body;
    const status   = requests?.request_status ?? requests?.status;

    // Only process fully completed documents
    if (status !== 'completed') {
      console.log('NDA webhook: skipping status', status);
      return;
    }

    const requestId   = requests.request_id;
    const requestName = requests.request_name ?? 'NDA';
    const actions     = requests.actions ?? [];
    const signer      = actions.find(a => a.role === 'Counterparty') ?? actions[0] ?? {};

    const recipientEmail = signer.recipient_email ?? signer.signing_email ?? '';
    const recipientName  = signer.recipient_name  ?? signer.signing_name  ?? '';

    // Pull field values from the signed document
    const textFields = signer.fields?.text_fields ?? [];
    const fieldVal   = label => textFields.find(f => f.field_label === label)?.field_value ?? '';

    const company  = fieldVal('company_name')    || 'Unknown Company';
    const entity   = fieldVal('entity_type');
    const title    = fieldVal('counterparty_title');
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

    console.log('NDA webhook: processing completion for', recipientEmail);

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
      console.log('NDA webhook: created Lead', JSON.stringify(createData?.data?.[0]));
    }

    // TODO: Send email notification to NDA_NOTIFY_EMAIL
    // Requires adding ZohoMail.messages.CREATE scope and ZOHO_MAIL_ACCOUNT_ID env var.
    // Until then, Zoho Sign automatically emails the document owner (mike.norris@digitalhive.com)
    // upon completion — check your Zoho Sign notification settings to confirm this is enabled.
    console.log(`NDA webhook: complete — ${recipientName} <${recipientEmail}>, ${company}, ${docLink}`);

  } catch (err) {
    console.error('nda-webhook error:', err.message);
  }
}
