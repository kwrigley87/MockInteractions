const state = {
  config: null,
  scenarios: [],
  accessToken: null,
  expiresAt: 0,
  user: null,
  users: [],
  queues: [],
  created: []
};

const $ = (id) => document.getElementById(id);

function base64Url(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomString(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, v => chars[v % chars.length]).join('');
}

async function sha256(value) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

function savePkce(verifier, stateValue) {
  sessionStorage.setItem('gc_pkce_verifier', verifier);
  sessionStorage.setItem('gc_oauth_state', stateValue);
}

function clearPkce() {
  sessionStorage.removeItem('gc_pkce_verifier');
  sessionStorage.removeItem('gc_oauth_state');
}

async function startLogin() {
  if (!state.config?.pkceClientId) {
    setStatus('PKCE client ID is not configured', 'warning');
    return;
  }
  const verifier = randomString(96);
  const challenge = base64Url(await sha256(verifier));
  const oauthState = crypto.randomUUID();
  savePkce(verifier, oauthState);

  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const scopes = [
    'conversations',
    'users:readonly',
    'routing:readonly',
    'analytics:readonly'
  ].join(' ');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: state.config.pkceClientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthState,
    scope: scopes
  });
  window.location.assign(`${state.config.loginBase}/oauth/authorize?${params}`);
}

async function completeLogin() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;

  const expectedState = sessionStorage.getItem('gc_oauth_state');
  const returnedState = params.get('state');
  const verifier = sessionStorage.getItem('gc_pkce_verifier');
  if (!verifier || !expectedState || returnedState !== expectedState) {
    throw new Error('OAuth state validation failed. Please start again.');
  }

  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const response = await fetch(`${state.config.loginBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: state.config.pkceClientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}) ${text.slice(0, 300)}`);
  }
  const token = await response.json();
  state.accessToken = token.access_token;
  state.expiresAt = Date.now() + Math.max(60, (token.expires_in || 3600) - 60) * 1000;
  sessionStorage.setItem('gc_access_token', state.accessToken);
  sessionStorage.setItem('gc_access_token_expires', String(state.expiresAt));
  clearPkce();
  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
}

function restoreToken() {
  const token = sessionStorage.getItem('gc_access_token');
  const expires = Number(sessionStorage.getItem('gc_access_token_expires') || 0);
  if (token && Date.now() < expires) {
    state.accessToken = token;
    state.expiresAt = expires;
    return true;
  }
  sessionStorage.removeItem('gc_access_token');
  sessionStorage.removeItem('gc_access_token_expires');
  return false;
}

function logout() {
  state.accessToken = null;
  sessionStorage.clear();
  window.location.reload();
}

async function api(path, method = 'GET', body = undefined) {
  if (!state.accessToken) throw new Error('Not authenticated');
  const response = await fetch(`${state.config.apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.accessToken}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || `Genesys API error ${response.status}`);
  return data;
}

async function fetchAll(path) {
  const result = [];
  let page = 1;
  while (page <= 50) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await api(`${path}${sep}pageSize=100&pageNumber=${page}`);
    result.push(...(data?.entities || []));
    if (!data?.nextUri) break;
    page++;
  }
  return result;
}

function selectedConversation() {
  const scenario = state.scenarios.find(s => s.id === $('scenarioSelect').value);
  return scenario?.conversations.find(c => c.id === $('conversationSelect').value) || null;
}

function selectedScenario() {
  return state.scenarios.find(s => s.id === $('scenarioSelect').value) || null;
}

function populateSelect(select, items, placeholder, labelFn = x => x.name) {
  select.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  select.appendChild(first);
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  }
}

function renderScenarioOptions() {
  populateSelect($('scenarioSelect'), state.scenarios, 'Select scenario...');
  if (state.scenarios.length) $('scenarioSelect').value = state.scenarios[0].id;
  renderConversationOptions();
}

function renderConversationOptions() {
  const scenario = selectedScenario();
  populateSelect($('conversationSelect'), scenario?.conversations || [], 'Select conversation...');
  if (scenario?.conversations?.length) $('conversationSelect').value = scenario.conversations[0].id;
  renderPreview();
}

function renderPreview() {
  const convo = selectedConversation();
  const scenario = selectedScenario();
  if (!convo) {
    $('conversationTitle').textContent = 'Select a conversation';
    $('preview').innerHTML = '';
    $('characteristics').innerHTML = '';
    return;
  }
  $('conversationTitle').textContent = convo.name;
  $('customerName').textContent = convo.customer.name;
  $('customerProfile').textContent = `${convo.customer.segment} · ${convo.customer.email}`;
  $('characteristics').innerHTML = '';
  for (const tag of [scenario?.name, ...convo.characteristics, `Outcome: ${convo.outcome}`]) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = tag;
    $('characteristics').appendChild(chip);
  }
  $('preview').innerHTML = '';
  convo.messages.forEach(m => {
    const row = document.createElement('div');
    row.className = `msg ${m.speaker}`;
    row.innerHTML = `<div class="bubble"><div class="speaker">${m.speaker}</div>${escapeHtml(m.text)}</div>`;
    $('preview').appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

function setStatus(message, tone = 'muted') {
  $('status').textContent = message;
  $('status').className = `badge ${tone === 'live' ? 'live' : tone === 'warning' ? 'muted' : 'muted'}`;
}

function updateAgentNote() {
  const selected = $('agentSelect').value;
  if (!selected) {
    $('agentNote').textContent = 'Choose the Genesys user who will receive the interaction. For automated agent replies, use the same user that is signed in to this app.';
    return;
  }
  if (selected === state.user?.id) {
    $('agentNote').textContent = 'Agent messages will be sent in the signed-in user context, so this is the recommended selection.';
  } else {
    $('agentNote').textContent = 'The selected user can be the routing target, but automated outbound agent messages require the signed-in user to be the active agent context.';
  }
}

async function createCustomerMessage(customer, text, metadata) {
  const response = await fetch('/api/customer/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId: customer.id, customer, text, metadata })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Customer message failed');
  return data;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForAgentConversation(conversationId, userId, maxMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const convo = await api(`/api/v2/conversations/${conversationId}`);
    const agent = convo.participants?.find(p => p.purpose === 'agent' && (!userId || p.userId === userId));
    if (agent) {
      const comm = agent.messages?.find(m => !m.disconnectedTime && (!m.state || m.state === 'connected')) || agent.chats?.find(m => !m.disconnectedTime && (!m.state || m.state === 'connected')) || agent.callbacks?.find(m => !m.disconnectedTime && (!m.state || m.state === 'connected')) || agent.emails?.find(m => !m.disconnectedTime && (!m.state || m.state === 'connected'));
      return { conversation: convo, agentParticipant: agent, communicationId: comm?.id || comm?.sessionId || comm?.peer };
    }
    await sleep(1500);
  }
  return null;
}

async function sendAgentMessage(conversationId, communicationId, text) {
  if (!communicationId) throw new Error('No connected agent communication was found. Make sure the signed-in user accepted the interaction.');
  return api(`/api/v2/conversations/messages/${conversationId}/communications/${communicationId}/messages`, 'POST', {
    body: text,
    bodyType: 'standard'
  });
}

async function disconnectConversation(conversationId) {
  return api(`/api/v2/conversations/messages/${conversationId}`, 'PATCH', { state: 'disconnected' });
}

async function createConversation(convo) {
  const agentId = $('agentSelect').value || state.user?.id;
  const queueId = $('queueSelect').value;
  if (!agentId) throw new Error('Select an agent');
  if (agentId !== state.user?.id) throw new Error('For automated scenario playback, select the signed-in Genesys user as the Agent. Genesys sends agent messages in the active user context.');
  if (!queueId) throw new Error('Select a queue');
  if (!$('agentSelect').value) $('agentSelect').value = state.user?.id || '';

  setProgress(0, 'Sending first customer message...');
  const customerId = `demo-${crypto.randomUUID()}`;
  const customer = { ...convo.customer, id: customerId };
  const baseMetadata = {
    syntheticDemo: 'true',
    scenario: selectedScenario()?.id || 'unknown',
    conversationVariant: convo.id,
    syntheticOutcome: convo.outcome
  };

  const first = await createCustomerMessage(customer, convo.messages[0].text, { customAttributes: baseMetadata });
  let conversationId = first.conversationId;
  if (!conversationId) {
    for (let i=0; i<8 && !conversationId; i++) {
      await sleep(1200);
      const probe = await api('/api/v2/conversations?state=connected');
      const match = (probe.entities || []).find(c => c.id);
      conversationId = match?.id;
    }
  }
  if (!conversationId) throw new Error('Genesys accepted the message but did not return a conversation ID. Check the Open Messaging routing/flow setup.');

  setProgress(15, 'Waiting for agent assignment...');
  const assignment = await waitForAgentConversation(conversationId, agentId);
  if (!assignment?.communicationId) {
    throw new Error('No connected agent communication found. Ensure the selected signed-in user is on the queue and can answer the message.');
  }

  const remaining = convo.messages.slice(1);
  const total = convo.messages.length;
  for (let i = 0; i < remaining.length; i++) {
    const m = remaining[i];
    if ($('includeTyping').checked) await sleep(m.delayMs ?? (m.speaker === 'customer' ? 900 : 1100));
    if (m.speaker === 'customer') {
      await createCustomerMessage(customer, m.text, { customAttributes: baseMetadata });
    } else {
      await sendAgentMessage(conversationId, assignment.communicationId, m.text);
    }
    setProgress(15 + Math.round(((i + 2) / total) * 75), `${m.speaker === 'customer' ? 'Customer' : 'Agent'} message ${i + 2} of ${total}`);
  }

  if ($('autoDisconnect').checked) {
    if ($('includeTyping').checked) await sleep(700);
    await disconnectConversation(conversationId);
  }
  setProgress(100, $('autoDisconnect').checked ? 'Conversation created and disconnected.' : 'Conversation created.');
  setStatus('Created', 'live');
  return { conversationId, customer, scenario: selectedScenario()?.name, conversation: convo.name, outcome: convo.outcome };
}

async function handleCreate() {
  const convo = selectedConversation();
  if (!convo) return;
  toggleButtons(true);
  try {
    const result = await createConversation(convo);
    state.created.unshift(result);
    renderHistory();
  } catch (err) {
    setProgress(100, err.message);
    setStatus('Failed', 'warning');
  } finally {
    toggleButtons(false);
  }
}

async function handleBatch() {
  const scenario = selectedScenario();
  if (!scenario) return;
  const variants = scenario.conversations.slice(0, 3);
  toggleButtons(true);
  try {
    for (let i = 0; i < variants.length; i++) {
      $('conversationSelect').value = variants[i].id;
      renderPreview();
      setStatus(`Creating ${i + 1} of ${variants.length}...`, 'live');
      const result = await createConversation(variants[i]);
      state.created.unshift(result);
      renderHistory();
      await sleep(500);
    }
    setStatus('Batch complete', 'live');
  } catch (err) {
    setProgress(100, err.message);
    setStatus('Batch failed', 'warning');
  } finally {
    toggleButtons(false);
  }
}

function toggleButtons(disabled) {
  $('createBtn').disabled = disabled;
  $('batchBtn').disabled = disabled;
}

function setProgress(percent, text) {
  $('progress').classList.remove('hidden');
  $('progressFill').style.width = `${percent}%`;
  $('progressText').textContent = text;
}

function renderHistory() {
  if (!state.created.length) {
    $('history').className = 'history-empty';
    $('history').textContent = 'No synthetic conversations created yet.';
    return;
  }
  $('history').className = '';
  $('history').innerHTML = state.created.map(item => `
    <div class="history-item">
      <div class="history-main"><strong>${escapeHtml(item.scenario)} — ${escapeHtml(item.conversation)}</strong>
        <div class="history-meta">${escapeHtml(item.outcome)} · ${escapeHtml(item.customer.name)}</div>
      </div>
      <div class="history-id">${escapeHtml(item.conversationId)}</div>
    </div>`).join('');
}

async function loadAppData() {
  const [me, users, queues, scenariosResponse] = await Promise.all([
    api('/api/v2/users/me'),
    fetchAll('/api/v2/users?state=active'),
    fetchAll('/api/v2/routing/queues'),
    fetch('/api/scenarios').then(r => r.json())
  ]);
  state.user = me;
  state.users = users;
  state.queues = queues;
  state.scenarios = scenariosResponse.scenarios || [];

  populateSelect($('agentSelect'), users, 'Select agent...', x => `${x.name}${x.id === me.id ? ' (You)' : ''}`);
  $('agentSelect').value = me.id;
  populateSelect($('queueSelect'), queues, 'Select queue...');
  if (queues.length === 1) $('queueSelect').value = queues[0].id;
  renderScenarioOptions();
  updateAgentNote();
}

function showApp() {
  $('loginPanel').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('loginBtn').classList.add('hidden');
  $('logoutBtn').classList.remove('hidden');
  $('identityBadge').textContent = state.user ? state.user.name : 'Signed in';
  $('identityBadge').className = 'badge live';
}

async function boot() {
  try {
    state.config = await fetch('/api/config').then(r => r.json());
    if (!state.config.pkceClientId) {
      $('configWarning').textContent = 'Set GENESYS_PKCE_CLIENT_ID in .env and create a Genesys Cloud OAuth client using Authorization Code + PKCE with this application URL as an authorized redirect URI.';
      $('configWarning').classList.remove('hidden');
    }
    const loggedInByCode = await completeLogin();
    const restored = restoreToken();
    if (loggedInByCode || restored) {
      await loadAppData();
      showApp();
    }
  } catch (err) {
    console.error(err);
    $('configWarning').textContent = err.message;
    $('configWarning').classList.remove('hidden');
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
