import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT || 3000);
const REGION = process.env.GENESYS_REGION || 'usw2.pure.cloud';
const API_BASE = `https://api.${REGION}`;
const LOGIN_BASE = `https://login.${REGION}`;
const SERVICE_CLIENT_ID = process.env.GENESYS_SERVICE_CLIENT_ID;
const SERVICE_CLIENT_SECRET = process.env.GENESYS_SERVICE_CLIENT_SECRET;
const INTEGRATION_ID = process.env.GENESYS_OPEN_MESSAGING_INTEGRATION_ID;
const PKCE_CLIENT_ID = process.env.GENESYS_PKCE_CLIENT_ID;

let serviceToken = null;
let serviceTokenExpiresAt = 0;

function requireServerConfig() {
  const missing = [];
  if (!SERVICE_CLIENT_ID) missing.push('GENESYS_SERVICE_CLIENT_ID');
  if (!SERVICE_CLIENT_SECRET) missing.push('GENESYS_SERVICE_CLIENT_SECRET');
  if (!INTEGRATION_ID) missing.push('GENESYS_OPEN_MESSAGING_INTEGRATION_ID');
  if (missing.length) {
    throw new Error(`Server configuration missing: ${missing.join(', ')}`);
  }
}

async function getServiceToken() {
  requireServerConfig();
  if (serviceToken && Date.now() < serviceTokenExpiresAt) return serviceToken;

  const basic = Buffer.from(`${SERVICE_CLIENT_ID}:${SERVICE_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${LOGIN_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Service OAuth failed (${response.status}): ${body.slice(0, 500)}`);
  }
  const data = await response.json();
  serviceToken = data.access_token;
  serviceTokenExpiresAt = Date.now() + Math.max(60, (data.expires_in || 300) - 60) * 1000;
  return serviceToken;
}

function safeError(message) {
  // Never return access tokens, client secrets, Authorization headers, or request bodies.
  return { error: message };
}

async function genesysServiceApi(pathname, method = 'GET', body) {
  const token = await getServiceToken();
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const detail = typeof data?.message === 'string' ? data.message : `Genesys API ${response.status}`;
    throw new Error(`${detail} (HTTP ${response.status})`);
  }
  return data;
}

app.get('/api/config', (_req, res) => {
  res.json({
    region: REGION,
    apiBase: API_BASE,
    loginBase: LOGIN_BASE,
    pkceClientId: PKCE_CLIENT_ID || null,
    hasServiceConfig: Boolean(SERVICE_CLIENT_ID && SERVICE_CLIENT_SECRET && INTEGRATION_ID)
  });
});

app.get('/api/scenarios', (_req, res) => {
  res.sendFile(path.join(__dirname, 'scenarios', 'scenarios.json'));
});

app.post('/api/customer/message', async (req, res) => {
  try {
    const { customerId, customer, text, metadata } = req.body || {};
    if (!customerId || !text) return res.status(400).json(safeError('customerId and text are required'));

    const now = new Date().toISOString();
    const messageId = randomUUID();
    const body = {
      type: 'Text',
      text,
      channel: {
        type: 'Private',
        messageId,
        to: { id: INTEGRATION_ID },
        from: {
          id: customerId,
          idType: 'Opaque',
          nickname: customer?.name || 'Synthetic Customer',
          firstName: customer?.firstName || undefined,
          lastName: customer?.lastName || undefined,
          email: customer?.email || undefined
        },
        time: now
      }
    };
    if (metadata && typeof metadata === 'object') {
      body.channel.metadata = metadata;
    }

    const result = await genesysServiceApi(
      `/api/v2/conversations/messages/${encodeURIComponent(INTEGRATION_ID)}/inbound/open/message?prefetchConversationId=true`,
      'POST',
      body
    );

    res.status(202).json({
      accepted: true,
      messageId,
      conversationId: result?.conversationId || result?.id || null
    });
  } catch (err) {
    console.error('[customer-message]', err.message);
    res.status(502).json(safeError(err.message));
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Genesys Synthetic Conversations running on http://localhost:${PORT}`);
});
