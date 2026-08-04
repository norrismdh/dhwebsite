/* ─── DH OPS MODULE ──────────────────────────────────────────────────────────
 * GET /api/ops/clients
 *
 * Client-health view for the /ops Clients tab. Gated by requireOps.
 *
 * Why this exists: feedback/CSAT isn't collected yet, so client happiness is
 * *hypothesised* from engagement recency. Thresholds (user's rule):
 *   ≤30 days since contact → healthy · 31–90 → warning · >90 → at risk
 *
 * What counts as "contact" (user decision): genuine two-way engagement only —
 * Desk ticket activity, commercial milestones (a won deal / completed renewal
 * IS engagement), and CRM meetings / inbound calls where they exist.
 * Explicitly EXCLUDED: auto-logged outbound calls (Apollo cadence), cadence
 * tasks, and marketing email — i.e. NOT Account.Last_Activity_Time, which is
 * dominated by bulk outbound and would make every client look "active".
 *
 * Client set = accounts with ≥1 Closed Won deal (real customers, not prospects).
 *
 * Scope note: everything CRM-side is derived from the **Deals** module and its
 * Account_Name lookup, so this needs no ZohoCRM.modules.accounts.READ scope on
 * top of the existing reporting token.
 *
 * Env: ZOHO_REPORTING_REFRESH_TOKEN (+ optional ZOHO_REPORTING_CLIENT_ID/SECRET)
 *      ZOHO_DESK_REFRESH_TOKEN + ZOHO_DESK_ORG_ID  (optional — adds ticket
 *      recency; without it the view degrades to milestones + meetings/calls)
 * ─────────────────────────────────────────────────────────────────────────── */

import { requireOps } from '../_auth.js';

const CRM_API    = 'https://www.zohoapis.com/crm/v2';
const DESK_API   = 'https://desk.zoho.com/api/v1';
const ZOHO_OAUTH = 'https://accounts.zoho.com/oauth/v2/token';
const PAGE_SIZE  = 200;
const MAX_PAGES  = 25;

const WARN_DAYS = 30;   // ≤ this = healthy
const RISK_DAYS = 90;   // > this = at risk

// ── Token helpers (one cache per audience) ──────────────────────────────────
const tokenCache = { crm: { value: null, exp: 0 }, desk: { value: null, exp: 0 } };

async function getToken(kind) {
  const slot = tokenCache[kind];
  const now = Date.now();
  if (slot.value && now < slot.exp) return slot.value;

  const conf = kind === 'desk'
    ? {
        id:     process.env.ZOHO_DESK_CLIENT_ID     || process.env.ZOHO_REPORTING_CLIENT_ID     || process.env.ZOHO_CLIENT_ID,
        secret: process.env.ZOHO_DESK_CLIENT_SECRET || process.env.ZOHO_REPORTING_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET,
        refresh: process.env.ZOHO_DESK_REFRESH_TOKEN,
      }
    : {
        id:     process.env.ZOHO_REPORTING_CLIENT_ID     || process.env.ZOHO_CLIENT_ID,
        secret: process.env.ZOHO_REPORTING_CLIENT_SECRET || process.env.ZOHO_CLIENT_SECRET,
        refresh: process.env.ZOHO_REPORTING_REFRESH_TOKEN,
      };

  const res = await fetch(ZOHO_OAUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: conf.id, client_secret: conf.secret,
      refresh_token: conf.refresh, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    console.error(`Zoho ${kind} token error:`, data);
    throw new Error(`Could not obtain Zoho ${kind} access token${data.error ? ` (${data.error})` : ''}`);
  }
  slot.value = data.access_token;
  slot.exp = now + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
  return slot.value;
}

// ── CRM COQL (≤2 WHERE conditions — this org's COQL rejects more) ───────────
async function coqlAll(baseQuery, token) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(`${CRM_API}/coql`, {
      method: 'POST',
      headers: { Authorization: `Zoho-oauthtoken ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ select_query: `${baseQuery} limit ${page * PAGE_SIZE}, ${PAGE_SIZE}` }),
    });
    if (res.status === 204) return rows;
    const json = await res.json();
    if (!res.ok) throw new Error(json?.message || `COQL HTTP ${res.status}`);
    rows.push(...(json.data ?? []));
    if (!json.info?.more_records) return rows;
  }
  return rows;
}

// ── Desk helpers ────────────────────────────────────────────────────────────
async function deskGet(path, token) {
  const res = await fetch(`${DESK_API}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId: process.env.ZOHO_DESK_ORG_ID },
  });
  if (res.status === 204) return {};
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(json?.message || json?.errorCode || `Desk HTTP ${res.status}`);
  return json;
}

/** Page a Desk list endpoint (limit 99 for tickets/accounts). */
async function deskPage(pathFor, token, size = 99) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await deskGet(pathFor(page * size + 1, size), token);
    const batch = json.data ?? [];
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
  return rows;
}

// ── Name matching (CRM account ↔ Desk account) ──────────────────────────────

const STOP_WORDS = /\b(inc|llc|ltd|limited|corp|corporation|company|co|plc|gmbh|bv|sa|group|holdings|the|of)\b/g;

/** Normalise a company name for fuzzy comparison. */
function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')       // drop parentheticals
    .replace(/[^a-z0-9\s]/g, ' ')   // punctuation → space
    .replace(STOP_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Acronym inside parentheses, e.g. "…Police (RCMP)" → "rcmp". */
function parenAlias(s) {
  const m = String(s ?? '').match(/\(([^)]+)\)/);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9]/g, '') : null;
}

/** All comparable keys for a name. */
function nameKeys(s) {
  const keys = new Set();
  const n = normName(s);
  if (n) keys.add(n);
  const a = parenAlias(s);
  if (a) keys.add(a);
  return keys;
}

// ── Misc helpers ────────────────────────────────────────────────────────────
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const ms = (v) => { const t = Date.parse(v ?? ''); return Number.isNaN(t) ? null : t; };
const DAY = 86400000;

/** A date-only string (YYYY-MM-DD) → epoch ms at local midnight. */
const dateMs = (d) => (d ? Date.parse(`${d}T00:00:00`) : null);

function classify(days) {
  if (days == null) return 'unknown';
  if (days > RISK_DAYS) return 'risk';
  if (days > WARN_DAYS) return 'warning';
  return 'healthy';
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireOps(req, res);
  if (!user) return; // 401 already sent

  if (!process.env.ZOHO_REPORTING_REFRESH_TOKEN) {
    return res.status(503).json({
      error: 'Zoho reporting token not configured. Set ZOHO_REPORTING_REFRESH_TOKEN (read scope).',
    });
  }

  const notes = [];
  const now = Date.now();

  try {
    const crmToken = await getToken('crm');

    // ── All deals (small module) → client set, lifetime value, milestones ────
    const deals = await coqlAll(
      'select Deal_Name, Stage, Amount, Closing_Date, Account_Name, Owner, Created_Time from Deals where id is not null',
      crmToken,
    );

    // Stage classification from the live picklist (forecast categories)
    let wonStages = new Set(['Closed Won']);
    let lostStages = new Set(['Closed Lost', 'Closed-Lost to Competition']);
    try {
      const fRes = await fetch(`${CRM_API}/settings/fields?module=Deals`, {
        headers: { Authorization: `Zoho-oauthtoken ${crmToken}` },
      });
      const fJson = await fRes.json();
      const stage = (fJson.fields ?? []).find((f) => f.api_name === 'Stage');
      const opts = stage?.pick_list_values ?? [];
      if (opts.length) {
        const won = new Set(), lost = new Set();
        for (const o of opts) {
          const cat = (o.forecast_category?.name ?? '').toLowerCase();
          if (cat === 'closed') won.add(o.display_value);
          else if (cat === 'omitted') lost.add(o.display_value);
        }
        if (won.size || lost.size) { wonStages = won; lostStages = lost; }
      }
    } catch { notes.push('Using fallback deal-stage classification'); }

    const isWon = (d) => wonStages.has(d.Stage);
    const isLost = (d) => lostStages.has(d.Stage);
    const isOpen = (d) => !isWon(d) && !isLost(d);

    // Build the client map from won deals
    const clients = new Map(); // accountId → record
    for (const d of deals) {
      if (!isWon(d) || !d.Account_Name?.id) continue;
      const id = d.Account_Name.id;
      const rec = clients.get(id) ?? {
        accountId: id,
        // Lookup sub-fields can come back null (inactive user, or a module this
        // token can't read), so keep the ids and resolve names separately below.
        name: d.Account_Name.name ?? null,
        ownerId: d.Owner?.id ?? null,
        owner: d.Owner?.name ?? null,
        lifetimeValue: 0,
        dealsWon: 0,
        lastWonAt: null,       // most recent PAST won-deal close (a milestone)
        lastWonName: null,
        nextRenewalAt: null,
        nextRenewalName: null,
        openPipeline: 0,
      };
      rec.lifetimeValue += num(d.Amount);
      rec.dealsWon += 1;
      const closed = dateMs(d.Closing_Date);
      // Only past closes count as engagement that already happened
      if (closed != null && closed <= now && (rec.lastWonAt == null || closed > rec.lastWonAt)) {
        rec.lastWonAt = closed;
        rec.lastWonName = d.Deal_Name;
      }
      // Prefer the most recent deal's owner as the account owner
      if (d.Owner?.name) rec.owner = rec.owner ?? d.Owner.name;
      if (d.Owner?.id) rec.ownerId = rec.ownerId ?? d.Owner.id;
      if (d.Account_Name.name) rec.name = rec.name ?? d.Account_Name.name;
      clients.set(id, rec);
    }

    // ── Resolve owner names via /users (covers inactive/deleted owners) ──────
    try {
      const uRes = await fetch(`${CRM_API}/users?type=AllUsers&per_page=200`, {
        headers: { Authorization: `Zoho-oauthtoken ${crmToken}` },
      });
      const uJson = await uRes.json();
      const userMap = new Map();
      for (const u of uJson.users ?? []) {
        userMap.set(String(u.id), u.full_name || `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim());
      }
      for (const rec of clients.values()) {
        if (!rec.owner && rec.ownerId) rec.owner = userMap.get(String(rec.ownerId)) ?? null;
      }
    } catch { notes.push('Owner names unavailable'); }

    // ── Resolve any missing account names ───────────────────────────────────
    // COQL returns the Account_Name lookup without its `name` when the token
    // can't read the Accounts module, so fetch names directly if needed.
    if ([...clients.values()].some((r) => !r.name)) {
      try {
        const accts = await coqlAll('select Account_Name from Accounts where id is not null', crmToken);
        const acctMap = new Map(accts.map((a) => [String(a.id), a.Account_Name]));
        for (const rec of clients.values()) {
          if (!rec.name) rec.name = acctMap.get(String(rec.accountId)) ?? null;
        }
      } catch {
        notes.push('Account names unavailable — add ZohoCRM.modules.accounts.READ to the reporting token');
      }
      // Last resort: label by the client's most recent deal so rows stay identifiable
      for (const rec of clients.values()) {
        if (!rec.name) { rec.name = rec.lastWonName || `Account ${rec.accountId}`; rec.nameFromDeal = true; }
      }
    }

    // Open deals → next renewal / open pipeline for those clients
    for (const d of deals) {
      if (!isOpen(d) || !d.Account_Name?.id) continue;
      const rec = clients.get(d.Account_Name.id);
      if (!rec) continue;
      rec.openPipeline += num(d.Amount);
      const close = dateMs(d.Closing_Date);
      if (close != null && close >= now && (rec.nextRenewalAt == null || close < rec.nextRenewalAt)) {
        rec.nextRenewalAt = close;
        rec.nextRenewalName = d.Deal_Name;
      }
    }

    // Deal id → client, so activities linked to a deal can be attributed
    const dealToClient = new Map();
    for (const d of deals) {
      if (d.Account_Name?.id && clients.has(d.Account_Name.id)) dealToClient.set(String(d.id), d.Account_Name.id);
    }

    // ── Genuine CRM contact: meetings + inbound calls (rare, but counted) ────
    for (const rec of clients.values()) { rec.lastMeetingAt = null; rec.lastInboundCallAt = null; }

    const attributeVia = (whatId, whoId) => {
      const wid = whatId?.id != null ? String(whatId.id) : null;
      if (wid) {
        if (clients.has(wid)) return wid;               // linked straight to the account
        const viaDeal = dealToClient.get(wid);
        if (viaDeal) return viaDeal;
      }
      return null; // person-linked activities need Contacts (out of scope for this token)
    };

    try {
      const events = await coqlAll('select Event_Title, Start_DateTime, What_Id, Who_Id from Events where id is not null', crmToken);
      for (const e of events) {
        const cid = attributeVia(e.What_Id, e.Who_Id);
        const t = ms(e.Start_DateTime);
        if (!cid || t == null || t > now) continue;
        const rec = clients.get(cid);
        if (rec && (rec.lastMeetingAt == null || t > rec.lastMeetingAt)) rec.lastMeetingAt = t;
      }
    } catch { notes.push('Meetings unavailable'); }

    try {
      const calls = await coqlAll('select Call_Type, Call_Start_Time, What_Id, Who_Id from Calls where id is not null', crmToken);
      for (const c of calls) {
        // Inbound only — outbound is Apollo cadence, which is marketing, not contact
        if (String(c.Call_Type ?? '').toLowerCase() !== 'inbound') continue;
        const cid = attributeVia(c.What_Id, c.Who_Id);
        const t = ms(c.Call_Start_Time);
        if (!cid || t == null || t > now) continue;
        const rec = clients.get(cid);
        if (rec && (rec.lastInboundCallAt == null || t > rec.lastInboundCallAt)) rec.lastInboundCallAt = t;
      }
    } catch { notes.push('Calls unavailable'); }

    // ── Desk ticket recency (optional — the strongest contact signal) ────────
    let deskLinked = 0;
    const deskConfigured = Boolean(process.env.ZOHO_DESK_REFRESH_TOKEN && process.env.ZOHO_DESK_ORG_ID);
    for (const rec of clients.values()) { rec.lastTicketAt = null; rec.openTickets = 0; rec.ticketsTotal = 0; }

    if (!deskConfigured) {
      notes.push('Zoho Desk not connected — ticket activity excluded from health');
    } else {
      try {
        const deskToken = await getToken('desk');

        // Desk account id → CRM client id, matched on normalised name
        const keyToClient = new Map();
        for (const rec of clients.values()) {
          for (const k of nameKeys(rec.name)) if (!keyToClient.has(k)) keyToClient.set(k, rec.accountId);
        }

        const deskAccounts = await deskPage((from, size) => `/accounts?from=${from}&limit=${size}`, deskToken);
        const deskAcctToClient = new Map();
        for (const a of deskAccounts) {
          for (const k of nameKeys(a.accountName ?? a.name)) {
            const cid = keyToClient.get(k);
            if (cid) { deskAcctToClient.set(String(a.id), cid); deskLinked += 1; break; }
          }
        }

        const tickets = await deskPage(
          (from, size) => `/tickets?from=${from}&limit=${size}&sortBy=-createdTime`,
          deskToken,
        );

        const openish = (t) => {
          const s = String(t.status ?? '').toLowerCase();
          return !(s === 'closed' || s === 'resolved' || s === 'merged' || s === 'spam');
        };

        for (const t of tickets) {
          const cid = deskAcctToClient.get(String(t.accountId));
          if (!cid) continue;
          const rec = clients.get(cid);
          if (!rec) continue;
          rec.ticketsTotal += 1;
          if (openish(t)) rec.openTickets += 1;
          // Latest touch on the ticket counts as contact
          const t1 = ms(t.modifiedTime) ?? ms(t.createdTime);
          if (t1 != null && t1 <= now && (rec.lastTicketAt == null || t1 > rec.lastTicketAt)) rec.lastTicketAt = t1;
        }

        if (!deskLinked) notes.push('No Desk accounts matched a client by name — ticket activity not attributed');
      } catch (e) {
        // /accounts sits under Desk's contacts scope — name it so the fix is obvious
        const scopeIssue = /scope/i.test(e.message);
        notes.push(scopeIssue
          ? 'Desk ticket activity unavailable — add Desk.contacts.READ to the Desk token (needed for /accounts)'
          : `Desk ticket activity unavailable (${e.message})`);
      }
    }

    // ── Resolve last contact + health ────────────────────────────────────────
    const list = [...clients.values()].map((rec) => {
      const sources = [
        { kind: 'ticket',    at: rec.lastTicketAt },
        { kind: 'meeting',   at: rec.lastMeetingAt },
        { kind: 'call',      at: rec.lastInboundCallAt },
        { kind: 'milestone', at: rec.lastWonAt },
      ].filter((s) => s.at != null);

      const best = sources.sort((a, b) => b.at - a.at)[0] ?? null;
      const lastContactAt = best?.at ?? null;
      const daysSince = lastContactAt != null ? Math.floor((now - lastContactAt) / DAY) : null;

      return {
        accountId: rec.accountId,
        name: rec.name,
        nameFromDeal: Boolean(rec.nameFromDeal),
        owner: rec.owner,
        lifetimeValue: rec.lifetimeValue,
        dealsWon: rec.dealsWon,
        openPipeline: rec.openPipeline,
        openTickets: rec.openTickets,
        ticketsTotal: rec.ticketsTotal,
        nextRenewalAt: rec.nextRenewalAt,
        nextRenewalName: rec.nextRenewalName,
        lastContactAt,
        lastContactKind: best?.kind ?? null,
        lastContactLabel: best?.kind === 'milestone' ? rec.lastWonName : null,
        daysSince,
        health: classify(daysSince),
      };
    });

    // Worst first: unknown → risk → warning → healthy, then oldest contact
    const rank = { unknown: 0, risk: 1, warning: 2, healthy: 3 };
    list.sort((a, b) => (rank[a.health] - rank[b.health]) || ((b.daysSince ?? 1e9) - (a.daysSince ?? 1e9)));

    const summary = {
      total: list.length,
      healthy: list.filter((c) => c.health === 'healthy').length,
      warning: list.filter((c) => c.health === 'warning').length,
      risk: list.filter((c) => c.health === 'risk').length,
      unknown: list.filter((c) => c.health === 'unknown').length,
    };

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      thresholds: { warnDays: WARN_DAYS, riskDays: RISK_DAYS },
      deskConnected: deskConfigured,
      summary,
      clients: list,
      meta: { notes },
    });
  } catch (err) {
    console.error('ops/clients error:', err.message);
    return res.status(502).json({ error: 'Could not load client data.', detail: err.message });
  }
}
