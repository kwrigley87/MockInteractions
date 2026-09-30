const CONFIG_KEY = 'syntheticConversations.config.v2';
const TOKEN_KEY = 'syntheticConversations.token.v2';
const PKCE_KEY = 'syntheticConversations.pkce.v2';

const state = {
  config: loadConfig(),
  token: null,
  user: null,
  users: [],
  queues: [],
  scenarios: [],
  created: [],
  currentConversationId: null,
  messengerLoaded: false,
  messengerReady: false,
  messengerConfigured: false,
  latestCustomerMessageId: null,
  lastMessengerError: null,
};

const $ = (id) => document.getElementById(id);

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; }
}
function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({
    region: state.config.region,
    clientId: state.config.clientId,
    deploymentId: state.config.deploymentId,
  }));
}
function redirectUri() { return `${location.origin}${location.pathname}`; }
function loginHost(region = state.config.region) { return `https://login.${region}`; }
function apiHost(region = state.config.region) { return `https://api.${region}`; }
function messengerHost(region = state.config.region) {
  const map = {
    'usw2.pure.cloud': 'apps.usw2.pure.cloud',
    'usw1.pure.cloud': 'apps.usw1.pure.cloud',
    'use1.pure.cloud': 'apps.use1.pure.cloud',
    'cac1.pure.cloud': 'apps.cac1.pure.cloud',
    'mypurecloud.ie': 'apps.mypurecloud.ie',
    'mypurecloud.de': 'apps.mypurecloud.de',
    'mypurecloud.com.au': 'apps.mypurecloud.com.au',
    'mypurecloud.jp': 'apps.mypurecloud.jp',
  };
  return map[region] || `apps.${region}`;
}
function messengerEnvironment(region = state.config.region) {
  const map = {
    'usw2.pure.cloud': 'prod-usw2',
    'usw1.pure.cloud': 'prod-usw1',
    'use1.pure.cloud': 'prod-use1',
    'cac1.pure.cloud': 'prod-cac1',
    'mypurecloud.ie': 'prod-euw1',
    'mypurecloud.de': 'prod-euc1',
    'mypurecloud.com.au': 'prod-apse2',
    'mypurecloud.jp': 'prod-apne1',
  };
  return map[region] || 'prod-usw2';
}
function randomString(bytes = 48) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, x => x.toString(16).padStart(2, '0')).join('');
}
async function challengeFor(verifier) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(d)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function setStatus(message, tone = 'muted') {
  $('status').textContent = message;
  $('status').className = `badge ${tone === 'live' ? 'live' : 'muted'}`;
}
function setProgress(percent, message) {
  $('progress').classList.remove('hidden');
  $('progressFill').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  $('progressText').textContent = message;
}
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function showLoginMessage(message) {
  $('configWarning').textContent = message;
  $('configWarning').classList.remove('hidden');
}

async function startLogin(event) {
  event?.preventDefault();
  const region = $('loginRegion').value;
  const clientId = $('oauthClientId').value.trim();
  const deploymentId = $('deploymentId').value.trim();

  if (!clientId) return showLoginMessage('Enter the OAuth client ID for the selected Genesys Cloud region.');
  if (!deploymentId) return showLoginMessage('Enter the Messenger deployment ID.');

  state.config = { region, clientId, deploymentId };
  saveConfig();

  const verifier = randomString(64);
  const oauthState = randomString(18);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({
    verifier,
    oauthState,
    region,
    clientId,
    deploymentId,
    redirectUri: redirectUri(),
    createdAt: Date.now(),
  }));

  const url = new URL(`${loginHost(region)}/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('code_challenge', await challengeFor(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', oauthState);
  location.assign(url.toString());
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const oauthError = params.get('error');
  if (!code && !oauthError) return false;

  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || '{}'); } catch { saved = {}; }

  history.replaceState({}, document.title, redirectUri());

  if (oauthError) {
    throw new Error(params.get('error_description') || `OAuth failed: ${oauthError}`);
  }
  if (!saved.verifier || params.get('state') !== saved.oauthState) {
    throw new Error('OAuth state validation failed. Start a new sign-in attempt.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: saved.clientId,
    code,
    redirect_uri: saved.redirectUri,
    code_verifier: saved.verifier,
  });

  const response = await fetch(`${loginHost(saved.region)}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = raw;
    try { detail = JSON.parse(raw)?.message || JSON.parse(raw)?.error_description || raw; } catch {}
    throw new Error(`Token exchange failed (${response.status}): ${String(detail).slice(0, 500)}`);
  }

  let token;
  try { token = JSON.parse(raw); } catch {
    throw new Error(`Token endpoint returned an unexpected response instead of JSON. HTTP ${response.status}.`);
  }

  token.expiresAt = Date.now() + ((token.expires_in || 3600) * 1000) - 60000;
  state.config = { region: saved.region, clientId: saved.clientId, deploymentId: saved.deploymentId };
  state.token = token;
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ config: state.config, token }));
  sessionStorage.removeItem(PKCE_KEY);
  saveConfig();
  return true;
}
function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || '{}');
    const token = saved.token;
    if (token?.access_token && token.expiresAt > Date.now()) {
      state.config = saved.config || state.config;
      state.token = token;
      return true;
    }
  } catch { sessionStorage.removeItem(TOKEN_KEY); }
  return false;
}
function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  state.token = null;
  location.assign(redirectUri());
}

async function gcFetch(method, path, payload = null) {
  if (!state.token?.access_token) throw new Error('Not authenticated.');
  const response = await fetch(`${apiHost()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const correlation = response.headers.get('inin-correlation-id') || response.headers.get('correlation-id');
    throw new Error(`${method} ${path} failed (${response.status})${correlation ? ` [${correlation}]` : ''}: ${data.message || data.error || raw || response.statusText}`);
  }
  return data;
}
async function fetchEntities(path) {
  const all = [];
  for (let page = 1; page <= 25; page += 1) {
    const join = path.includes('?') ? '&' : '?';
    const d = await gcFetch('GET', `${path}${join}pageSize=100&pageNumber=${page}`);
    const rows = d.entities || [];
    all.push(...rows);
    if (!d.nextUri && rows.length < 100) break;
  }
  return all;
}

function populate(select, items, placeholder, label = x => x.name) {
  select.innerHTML = '';
  const p = document.createElement('option');
  p.value = '';
  p.textContent = placeholder;
  select.appendChild(p);
  for (const item of items) {
    const o = document.createElement('option');
    o.value = item.id;
    o.textContent = label(item);
    select.appendChild(o);
  }
}
function selectedScenario() {
  return state.scenarios.find(s => s.id === $('scenarioSelect').value) || null;
}
function selectedConversation() {
  const scenario = selectedScenario();
  return scenario?.conversations.find(c => c.id === $('conversationSelect').value) || null;
}
function renderScenarioOptions() {
  populate($('scenarioSelect'), state.scenarios, 'Select scenario...');
  if (state.scenarios[0]) $('scenarioSelect').value = state.scenarios[0].id;
  renderConversationOptions();
}
function renderConversationOptions() {
  const scenario = selectedScenario();
  populate($('conversationSelect'), scenario?.conversations || [], 'Select conversation...');
  if (scenario?.conversations[0]) $('conversationSelect').value = scenario.conversations[0].id;
  renderPreview();
}
function renderPreview() {
  const conversation = selectedConversation();
  const scenario = selectedScenario();
  if (!conversation) {
    $('conversationTitle').textContent = 'Select a conversation';
    $('preview').innerHTML = '';
    $('characteristics').innerHTML = '';
    return;
  }
  $('conversationTitle').textContent = conversation.name;
  $('customerName').textContent = conversation.customer.name;
  $('customerProfile').textContent = `${conversation.customer.segment} · ${conversation.customer.email}`;
  $('characteristics').innerHTML = '';
  for (const tag of [scenario?.name, ...(conversation.characteristics || []), `Outcome: ${conversation.outcome}`]) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    $('characteristics').appendChild(chip);
  }
  $('preview').innerHTML = (conversation.messages || []).map(m => `
    <div class="msg ${m.speaker}">
      <div class="bubble"><div class="speaker">${escapeHtml(m.speaker)}</div>${escapeHtml(m.text)}</div>
    </div>`).join('');
}
function setHeadlessConfigurationNote() {
  const el = $('agentNote');
  if (!el || !state.user) return;
  el.textContent = 'Signed in. Use a Messenger configuration with native UI OFF and Automatically Start Conversations OFF. This generator starts each customer conversation explicitly.';
}

function updateAgentNote() {
  const selected = $('agentSelect').value;
  $('agentNote').textContent = selected === state.user?.id
    ? 'Selected agent is the signed-in user. Automated agent messages use this user context.'
    : 'Automated playback requires the selected agent to be the signed-in user.';
}

function ensureGenesysQueue() {
  if (window.Genesys && window.Genesys.q) return window.Genesys;
  window._genesysJs = 'Genesys';
  window.Genesys = window.Genesys || function() {
    (window.Genesys.q = window.Genesys.q || []).push(arguments);
  };
  window.Genesys.t = Date.now();
  window.Genesys.c = {
    environment: messengerEnvironment(),
    deploymentId: state.config.deploymentId,
    debug: true,
  };
  return window.Genesys;
}

function subscribeMessengerEvents() {
  const Genesys = ensureGenesysQueue();


  Genesys('subscribe', 'MessagingService.started', (event) => {
    console.debug('[Synthetic] MessagingService.started', event);
  });

  Genesys('subscribe', 'MessagingService.ready', (event) => {
    console.debug('[Synthetic] MessagingService.ready', event);
    state.messengerReady = true;
  });

  Genesys('subscribe', 'MessagingService.error', (event) => {
    console.error('[Synthetic] MessagingService.error', event);
    state.lastMessengerError = event;
  });

  Genesys('subscribe', 'MessagingService.conversationDisconnected', (event) => {
    console.debug('[Synthetic] MessagingService.conversationDisconnected', event);
  });
}

async function injectMessenger() {
  if (state.messengerLoaded) {
    if (!state.messengerReady) await waitForMessengerReady();
    return;
  }
  if (!state.config.deploymentId) throw new Error('Messenger deployment ID is required.');

  ensureGenesysQueue();
  subscribeMessengerEvents();

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.charset = 'utf-8';
    script.src = `https://${messengerHost()}/genesys-bootstrap/genesys.min.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load Genesys Messenger from ${messengerHost()}.`));
    document.head.appendChild(script);
  });

  state.messengerLoaded = true;
  await waitForMessengerReady();
}

async function waitForMessengerReady(timeoutMs = 15000) {
  const started = Date.now();
  while (!state.messengerReady) {
    if (state.lastMessengerError) {
      throw new Error(`Messenger reported an error during initialization. Open the browser console for the event details.`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error('Messenger SDK loaded but MessagingService.ready was not received within 15 seconds. Check the deployment, domain access and browser console.');
    }
    await sleep(250);
  }
}

function messengerCommand(name, data = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!window.Genesys) return reject(new Error('Messenger SDK is not loaded.'));
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error(`${name} timed out after ${timeoutMs / 1000}s.`)), timeoutMs);
    try {
      window.Genesys('command', name, data, result => finish(resolve, result), error => {
        const detail = typeof error === 'string' ? error : JSON.stringify(error || {});
        finish(reject, new Error(`${name} failed${detail && detail !== '{}' ? `: ${detail}` : ''}`));
      });
    } catch (error) {
      finish(reject, error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function setCustomerData(customer, scenario, conversation, queue) {
  const custom = {
    syntheticDemo: 'true',
    scenario: scenario.id,
    conversationVariant: conversation.id,
    syntheticOutcome: conversation.outcome,
    syntheticCustomerId: customer.id,
    syntheticCustomerName: customer.name || '',
    syntheticTargetQueueId: queue || '',
  };
  await messengerCommand('Database.set', { messaging: { customAttributes: custom } }, 10000);
}

async function prepareNewMessengerSession() {
  // Deterministic mode for this static demo generator:
  // Native Messenger UI = OFF
  // Automatically Start Conversations = OFF
  // Sequence = configureConversation -> sendMessage
  // We deliberately do not use the auto-start/join path here.

  state.latestCustomerMessageId = null;
  state.lastMessengerError = null;
  state.messengerConfigured = false;

  // End/clear any previous demo session. With auto-start OFF it will not
  // immediately recreate itself while we prepare the next run.
  try {
    await messengerCommand('MessagingService.disconnectConversation', {}, 8000);
  } catch (e) {
    console.debug('[Synthetic] no previous conversation to disconnect:', e.message);
  }
  try {
    await messengerCommand('MessagingService.clearConversation', {}, 8000);
  } catch (e) {
    console.debug('[Synthetic] no previous conversation to clear:', e.message);
  }
  await sleep(750);

  const configured = await messengerCommand('MessagingService.configureConversation', {}, 20000);
  state.messengerConfigured = true;
  console.debug('[Synthetic] configureConversation succeeded:', configured);
  return configured;
}

async function sendCustomer(text) {
  state.latestCustomerMessageId = null;
  const result = await messengerCommand('MessagingService.sendMessage', { message: text }, 15000);
  console.debug('[Synthetic] customer message send result', result);
  return result;
}

async function resolveConversationFromMessage(messageId) {
  const path = `/api/v2/conversations/messages/${encodeURIComponent(messageId)}/details?useNormalizedMessage=true`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const details = await gcFetch('GET', path);
      if (details.conversationId) return details.conversationId;
    } catch (error) {
      console.debug('[Synthetic] message details not ready yet', attempt + 1, error.message);
    }
    await sleep(750);
  }
  return null;
}

async function waitForCustomerMessageId(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (state.latestCustomerMessageId) return state.latestCustomerMessageId;
    await sleep(250);
  }
  return null;
}

function collectPotentialIds(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    if (value.length >= 20) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPotentialIds(item, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/^(id|messageId|conversationId)$/i.test(key) && typeof child === 'string') {
        out.push(child);
      } else if (/message|data|result|response|conversation/i.test(key)) {
        collectPotentialIds(child, out);
      }
    }
  }
  return out;
}

async function getConversationFromFirstMessage(sendResult) {
  const candidates = [...new Set(collectPotentialIds(sendResult))];
  console.debug('[Synthetic] IDs returned by sendMessage:', candidates, sendResult);
  for (const id of candidates) {
    const conversationId = await resolveConversationFromMessage(id);
    if (conversationId) return conversationId;
  }
  return null;
}

async function waitForAgentConversation(conversationId, userId, maxMs = 60000) {
  const started = Date.now();
  let lastState = '';
  while (Date.now() - started < maxMs) {
    const data = await gcFetch('GET', `/api/v2/conversations/${conversationId}`);
    const agent = data.participants?.find(p => p.purpose === 'agent' && (!userId || p.userId === userId));
    const communications = agent?.messages || agent?.communications || [];
    const communication = communications.find(c => !c.disconnectedTime && String(c.state || '').toLowerCase() !== 'complete');
    lastState = agent ? (communication?.state || 'agent participant present') : 'waiting for agent participant';
    setProgress(18, `Waiting for agent assignment (${lastState})...`);
    if (agent && communication?.id) {
      return { agentParticipant: agent, communicationId: communication.id };
    }
    await sleep(1500);
  }
  return null;
}

async function sendAgent(conversationId, communicationId, text) {
  return gcFetch('POST', `/api/v2/conversations/messages/${conversationId}/communications/${communicationId}/messages`, { textBody: text });
}

async function disconnect(conversationId) {
  try {
    return await gcFetch('PATCH', `/api/v2/conversations/messages/${conversationId}`, { state: 'disconnected' });
  } finally {
    try { await messengerCommand('MessagingService.disconnectConversation', {}, 8000); } catch {}
    try { await messengerCommand('MessagingService.clearConversation', {}, 8000); } catch {}
  }
}

async function createConversation(conversation) {
  const agentId = $('agentSelect').value || state.user?.id;
  if (!agentId) throw new Error('Select an agent.');
  if (agentId !== state.user?.id) throw new Error('For automated playback, select the signed-in user as the agent.');

  const scenario = selectedScenario();
  const queue = $('queueSelect').value || '';
  if (!conversation?.messages?.length) throw new Error('The selected scenario has no messages.');

  const customer = { ...conversation.customer, id: `demo-${crypto.randomUUID()}` };

  setProgress(2, 'Loading Messenger...');
  await injectMessenger();
  setProgress(5, 'Preparing a new customer session...');
  await prepareNewMessengerSession();

  // Database.set should happen before the first customer message so the attributes can travel with the interaction.
  setProgress(8, 'Setting synthetic customer data...');
  await setCustomerData(customer, scenario, conversation, queue);

  setProgress(12, 'Sending first customer message...');
  const firstSendResult = await sendCustomer(conversation.messages[0].text);
  const conversationId = await getConversationFromFirstMessage(firstSendResult);
  if (!conversationId) {
    throw new Error('Customer message was sent, but this browser build could not resolve the resulting message to a conversation ID. The app will not retry configuration or create a second session. Check the browser console for the sendMessage result.');
  }

  state.currentConversationId = conversationId;
  setProgress(18, 'Waiting for the interaction to reach the agent...');
  const assignment = await waitForAgentConversation(conversationId, agentId);
  if (!assignment) {
    throw new Error('The interaction was not connected to the signed-in agent within 60 seconds. Check the inbound message flow, target queue, queue membership and agent status.');
  }

  const total = conversation.messages.length;
  for (let i = 1; i < total; i += 1) {
    const message = conversation.messages[i];
    if ($('includeTyping').checked) await sleep(message.delayMs ?? (message.speaker === 'customer' ? 900 : 1100));
    if (message.speaker === 'customer') {
      await sendCustomer(message.text);
    } else {
      await sendAgent(conversationId, assignment.communicationId, message.text);
    }
    setProgress(18 + Math.round(((i + 1) / total) * 75), `${message.speaker === 'customer' ? 'Customer' : 'Agent'} message ${i + 1} of ${total}`);
  }

  if ($('autoDisconnect').checked) {
    await sleep(700);
    await disconnect(conversationId);
  }
  setProgress(100, $('autoDisconnect').checked ? 'Conversation created and disconnected.' : 'Conversation created.');
  setStatus('Created', 'live');
  return {
    conversationId,
    customer,
    scenario: scenario.name,
    conversation: conversation.name,
    outcome: conversation.outcome,
  };
}

async function handleCreate() {
  const conversation = selectedConversation();
  if (!conversation) return;
  toggle(true);
  try {
    const result = await createConversation(conversation);
    state.created.unshift(result);
    renderHistory();
  } catch (error) {
    console.error(error);
    setProgress(100, error.message || String(error));
    setStatus('Failed', 'warning');
  } finally {
    toggle(false);
  }
}
async function handleBatch() {
  const scenario = selectedScenario();
  if (!scenario) return;
  toggle(true);
  try {
    for (const conversation of scenario.conversations.slice(0, 3)) {
      const result = await createConversation(conversation);
      state.created.unshift(result);
      renderHistory();
      await sleep(700);
    }
  } catch (error) {
    console.error(error);
    setProgress(100, error.message || String(error));
    setStatus('Batch failed', 'warning');
  } finally {
    toggle(false);
  }
}
function toggle(disabled) {
  $('createBtn').disabled = disabled;
  $('batchBtn').disabled = disabled;
}
function renderHistory() {
  if (!state.created.length) {
    $('history').className = 'history-empty';
    $('history').textContent = 'No synthetic conversations created yet.';
    return;
  }
  $('history').className = '';
  $('history').innerHTML = state.created.map(x => `
    <div class="history-item">
      <div class="history-main">
        <strong>${escapeHtml(x.scenario)} — ${escapeHtml(x.conversation)}</strong>
        <div class="history-meta">${escapeHtml(x.outcome)} · ${escapeHtml(x.customer?.name || 'Synthetic Customer')}</div>
      </div>
      <div class="history-id">${escapeHtml(x.conversationId || '')}</div>
    </div>`).join('');
}

async function boot() {
  $('loginRegion').value = state.config.region || 'usw2.pure.cloud';
  $('oauthClientId').value = state.config.clientId || '';
  $('deploymentId').value = state.config.deploymentId || '';
  $('redirectUri').textContent = redirectUri();

  try {
    await handleOAuthCallback();
    restoreSession();
    if (!state.token) return;

    const [me, users, queues, scenarioResponse] = await Promise.all([
      gcFetch('GET', '/api/v2/users/me'),
      fetchEntities('/api/v2/users?state=active'),
      fetchEntities('/api/v2/routing/queues'),
      fetch('scenarios/scenarios.json').then(r => {
        if (!r.ok) throw new Error(`Could not load scenario library (${r.status}).`);
        return r.json();
      }),
    ]);

    state.user = me;
    state.users = users;
    state.queues = queues;
    state.scenarios = scenarioResponse.scenarios || [];

    populate($('agentSelect'), users, 'Select agent...', x => `${x.name}${x.id === me.id ? ' (You)' : ''}`);
    $('agentSelect').value = me.id;
    populate($('queueSelect'), queues, 'Select queue...');
    renderScenarioOptions();
    updateAgentNote();
  setHeadlessConfigurationNote();

    $('loginPanel').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('loginBtn').classList.add('hidden');
    $('logoutBtn').classList.remove('hidden');
    $('identityBadge').textContent = me.name;
    $('identityBadge').className = 'badge live';
  } catch (error) {
    console.error(error);
    showLoginMessage(error.message || String(error));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('loginBtn').addEventListener('click', startLogin);
  $('logoutBtn').addEventListener('click', logout);
  $('scenarioSelect').addEventListener('change', renderConversationOptions);
  $('conversationSelect').addEventListener('change', renderPreview);
  $('agentSelect').addEventListener('change', updateAgentNote);
  $('createBtn').addEventListener('click', handleCreate);
  $('batchBtn').addEventListener('click', handleBatch);
  boot();
});
