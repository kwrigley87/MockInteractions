const CONFIG_KEY = 'syntheticConversations.config.v2';
const TOKEN_KEY = 'syntheticConversations.token.v2';
const PKCE_KEY = 'syntheticConversations.pkce.v2';

const state = {
  config: loadConfig(), token: null, user: null, users: [], queues: [],
  scenarios: [], created: [], messengerLoaded: false, messengerReady: false,
  currentConversationId: null, currentMessengerGeneration: 0
};

const $ = (id) => document.getElementById(id);

function loadConfig(){ try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'{}')}catch{return{}} }
function saveConfig(){ localStorage.setItem(CONFIG_KEY, JSON.stringify({region: state.config.region, clientId: state.config.clientId, deploymentId: state.config.deploymentId})); }
function redirectUri(){ return `${location.origin}${location.pathname}`; }
function loginHost(){ return `https://login.${state.config.region}`; }
function apiHost(){ return `https://api.${state.config.region}`; }
function messengerBootstrapHost(){
  const map={
    'usw2.pure.cloud':'apps.usw2.pure.cloud','usw1.pure.cloud':'apps.usw1.pure.cloud','use1.pure.cloud':'apps.use1.pure.cloud',
    'cac1.pure.cloud':'apps.cac1.pure.cloud','mypurecloud.ie':'apps.mypurecloud.ie','mypurecloud.de':'apps.mypurecloud.de',
    'mypurecloud.com.au':'apps.mypurecloud.com.au','mypurecloud.jp':'apps.mypurecloud.jp'
  };
  return map[state.config.region] || `apps.${state.config.region}`;
}
function randomString(bytes=48){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('')}
async function challengeFor(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function setStatus(message,tone='muted'){ $('status').textContent=message; $('status').className=`badge ${tone==='live'?'live':'muted'}`; }
function setProgress(p,msg){$('progress').classList.remove('hidden');$('progressFill').style.width=`${p}%`;$('progressText').textContent=msg}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

async function startLogin(e){e?.preventDefault();
  state.config.region=$('loginRegion').value; state.config.clientId=$('oauthClientId').value.trim(); state.config.deploymentId=$('deploymentId').value.trim(); saveConfig();
  if(!state.config.clientId || !state.config.deploymentId){showLoginMessage('Enter the OAuth client ID and Messenger deployment ID.');return}
  const verifier=randomString(64), oauthState=randomString(18); sessionStorage.setItem(PKCE_KEY,JSON.stringify({verifier,oauthState,...state.config,redirectUri:redirectUri()}));
  const url=new URL(`${loginHost()}/oauth/authorize`); url.searchParams.set('client_id',state.config.clientId);url.searchParams.set('response_type','code');url.searchParams.set('redirect_uri',redirectUri());url.searchParams.set('code_challenge',await challengeFor(verifier));url.searchParams.set('code_challenge_method','S256');url.searchParams.set('state',oauthState);
  location.assign(url.toString());
}
async function handleOAuthCallback(){const p=new URLSearchParams(location.search);const code=p.get('code'),err=p.get('error');if(!code&&!err)return false;const saved=JSON.parse(sessionStorage.getItem(PKCE_KEY)||'{}');history.replaceState({},document.title,redirectUri());if(err)throw new Error(p.get('error_description')||`OAuth failed: ${err}`);if(!saved.verifier||p.get('state')!==saved.oauthState)throw new Error('OAuth state validation failed.');
  const body=new URLSearchParams({grant_type:'authorization_code',client_id:saved.clientId,code,redirect_uri:saved.redirectUri,code_verifier:saved.verifier});const r=await fetch(`${loginHostFrom(saved.region)}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});if(!r.ok)throw new Error(`Token exchange failed (${r.status}). Check PKCE client and redirect URI.`);
  const token=await r.json();token.expiresAt=Date.now()+((token.expires_in||3600)*1000)-60000;state.config={region:saved.region,clientId:saved.clientId,deploymentId:saved.deploymentId};state.token=token;sessionStorage.setItem(TOKEN_KEY,JSON.stringify({config:state.config,token}));sessionStorage.removeItem(PKCE_KEY);saveConfig();return true;
}
function loginHostFrom(r){return `https://login.${r}`}
function restoreSession(){try{const x=JSON.parse(sessionStorage.getItem(TOKEN_KEY)||'{}');if(x.token?.access_token&&x.token.expiresAt>Date.now()){state.config=x.config||state.config;state.token=x.token;return true}}catch{}return false}
function logout(){sessionStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(PKCE_KEY);state.token=null;location.assign(redirectUri())}
function showLoginMessage(msg){$('configWarning').textContent=msg;$('configWarning').classList.remove('hidden')}

async function gcFetch(method,path,payload=null){if(!state.token?.access_token)throw new Error('Not authenticated');const r=await fetch(`${apiHost()}${path}`,{method,headers:{Authorization:`Bearer ${state.token.access_token}`,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={message:t}}if(!r.ok)throw new Error(d.message||d.error||`Genesys API error ${r.status}`);return d}
async function fetchEntities(path){const all=[];for(let n=1;n<=25;n++){const join=path.includes('?')?'&':'?';const d=await gcFetch('GET',`${path}${join}pageSize=100&pageNumber=${n}`);const rows=d.entities||[];all.push(...rows);if(!d.nextUri||rows.length<100)break}return all}

function selectedScenario(){return state.scenarios.find(s=>s.id===$('scenarioSelect').value)||null}
function selectedConversation(){const s=selectedScenario();return s?.conversations.find(c=>c.id===$('conversationSelect').value)||null}
function populate(select,items,placeholder,label=x=>x.name){select.innerHTML='';const p=document.createElement('option');p.value='';p.textContent=placeholder;select.appendChild(p);for(const x of items){const o=document.createElement('option');o.value=x.id;o.textContent=label(x);select.appendChild(o)}}
function renderScenarioOptions(){populate($('scenarioSelect'),state.scenarios,'Select scenario...');if(state.scenarios[0])$('scenarioSelect').value=state.scenarios[0].id;renderConversationOptions()}
function renderConversationOptions(){const s=selectedScenario();populate($('conversationSelect'),s?.conversations||[],'Select conversation...');if(s?.conversations[0])$('conversationSelect').value=s.conversations[0].id;renderPreview()}
function renderPreview(){const c=selectedConversation(),s=selectedScenario();if(!c){$('conversationTitle').textContent='Select a conversation';$('preview').innerHTML='';$('characteristics').innerHTML='';return}$('conversationTitle').textContent=c.name;$('customerName').textContent=c.customer.name;$('customerProfile').textContent=`${c.customer.segment} · ${c.customer.email}`;$('characteristics').innerHTML='';for(const t of [s?.name,...(c.characteristics||[]),`Outcome: ${c.outcome}`]){const chip=document.createElement('span');chip.className='chip';chip.textContent=t;$('characteristics').appendChild(chip)}$('preview').innerHTML=(c.messages||[]).map(m=>`<div class="msg ${m.speaker}"><div class="bubble"><div class="speaker">${escapeHtml(m.speaker)}</div>${escapeHtml(m.text)}</div></div>`).join('')}
function updateAgentNote(){const id=$('agentSelect').value;if(!id){$('agentNote').textContent='Sign in as the agent you want the generated interaction to be handled by. Automated agent replies use the signed-in user context.';return}$('agentNote').textContent=id===state.user?.id?'Recommended: selected agent is the signed-in user. The API will send agent responses in that user context.':'The selected agent can be a routing target, but automated agent responses are only sent in the signed-in user context. For playback, sign in as that agent.'}

async function loadMessenger(){if(state.messengerLoaded){return};if(!state.config.deploymentId)throw new Error('Messenger deployment ID is required.');
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.async=true;script.charset='utf-8';script.src=`https://${messengerBootstrapHost()}/genesys-bootstrap/genesys.min.js`;
    script.onload=resolve;script.onerror=()=>reject(new Error('Could not load the Genesys Messenger SDK for this region.'));
    window._genesysBootstrapConfig={deploymentId:state.config.deploymentId,environment:'prod'};
    // The bootstrap expects the configuration object passed when the script is inserted.
    document.head.appendChild(script);
  });
  // The bootstrap snippet needs its config at queue creation time; in current Genesys builds the
  // documented pattern is the global Genesys() function plus the deployment configuration. We use
  // the same queue shape explicitly here for static hosting.
  state.messengerLoaded=true;
}
function bootstrapMessengerCorrectly(){
  if(window.Genesys && window.Genesys._syntheticConfigured)return;
  const deploymentId=state.config.deploymentId, environment='prod';
  // If the first load came from the generic bootstrap without inline config, reload with the
  // documented snippet configuration once. This path is harmless on subsequent loads.
  if(!window.Genesys)return;
}
function injectMessenger(){return new Promise((resolve,reject)=>{
  if(state.messengerReady){resolve();return}
  if(!state.config.deploymentId)throw new Error('Messenger deployment ID is required.');
  const script=document.createElement('script');script.type='text/javascript';script.charset='utf-8';script.async=true;
  script.textContent='';
  // Create the official queue/bootstrap pattern with this deployment configuration.
  (function(g,e,n,es,ys){g['_genesysJs']=e;g[e]=g[e]||function(){(g[e].q=g[e].q||[]).push(arguments)};g[e].t=1*new Date();g[e].c=es;ys=document.createElement('script');ys.async=1;ys.src=n;ys.charset='utf-8';ys.onload=function(){resolve()};ys.onerror=function(){reject(new Error('Unable to load Genesys Messenger.'))};document.head.appendChild(ys)})(window,'Genesys',`https://${messengerBootstrapHost()}/genesys-bootstrap/genesys.min.js`,{environment:'prod',deploymentId:state.config.deploymentId});
  window.Genesys('subscribe','MessagingService.ready',function(){state.messengerReady=true;resolve()});
  window.Genesys('subscribe','MessagingService.error',function(evt){console.error('Messenger error',evt)});
});}
function messengerCommand(name,data={}){return new Promise((resolve,reject)=>{if(!window.Genesys)return reject(new Error('Messenger SDK is not loaded.'));window.Genesys('command',name,data,d=>resolve(d),e=>reject(e||new Error(`${name} failed`)))})}
async function setCustomerData(customer,scenario,convo,queue){
  const custom={syntheticDemo:'true',scenario:scenario.id,conversationVariant:convo.id,syntheticOutcome:convo.outcome,syntheticCustomerId:customer.id,syntheticCustomerName:customer.name||'',syntheticTargetQueueId:queue||''};
  try{await messengerCommand('Database.set',{messaging:{customAttributes:custom}})}catch(e){console.warn('Database.set failed',e)}
}
async function clearCustomerConversation(){try{await messengerCommand('MessagingService.clearConversation')}catch(e){}}

async function getConversationFromMessage(messageId){for(let i=0;i<12;i++){try{const d=await gcFetch('GET',`/api/v2/conversations/messages/${encodeURIComponent(messageId)}/details`);if(d.conversationId)return d.conversationId}catch(e){}await sleep(700)}return null}
let latestCustomerMessageId=null;
function captureCustomerMessage(evt){const m=evt?.data?.messages||[];for(const x of m){if(x?.direction==='outbound'||x?.type==='TEXT'||x?.message?.direction==='outbound'){};if(x?.id)latestCustomerMessageId=x.id}}
async function startCustomerConversation(){
  await clearCustomerConversation(); latestCustomerMessageId=null;
  await messengerCommand('MessagingService.startConversation');
  await sleep(400);
}
async function sendCustomer(text){latestCustomerMessageId=null;await messengerCommand('MessagingService.sendMessage',{message:text});await sleep(500);return latestCustomerMessageId}
async function waitForConversationId(maxMs=20000){const start=Date.now();while(Date.now()-start<maxMs){if(latestCustomerMessageId){const id=await getConversationFromMessage(latestCustomerMessageId);if(id)return id}await sleep(600)}return null}
async function waitForAgentConversation(conversationId,userId,maxMs=30000){const start=Date.now();while(Date.now()-start<maxMs){const d=await gcFetch('GET',`/api/v2/conversations/${conversationId}`);const agent=d.participants?.find(p=>p.purpose==='agent'&&(!userId||p.userId===userId));const comm=agent?.messages?.find(m=>!m.disconnectedTime&&String(m.state||'').toLowerCase()!=='complete');if(agent&&comm?.id)return{agentParticipant:agent,communicationId:comm.id};await sleep(1200)}return null}
async function sendAgent(conversationId,communicationId,text){return gcFetch('POST',`/api/v2/conversations/messages/${conversationId}/communications/${communicationId}/messages`,{textBody:text})}
async function disconnect(conversationId){try{return await gcFetch('PATCH',`/api/v2/conversations/messages/${conversationId}`,{state:'disconnected'})}finally{try{await messengerCommand('MessagingService.disconnectConversation')}catch(e){}}}

async function createConversation(convo){
  const agentId=$('agentSelect').value||state.user?.id;if(!agentId)throw new Error('Select an agent.');if(agentId!==state.user?.id)throw new Error('For automated playback, sign in as the same agent selected in the Agent field.');
  const scenario=selectedScenario(),queue=$('queueSelect').value||'';const customer={...convo.customer,id:`demo-${crypto.randomUUID()}`};
  setProgress(2,'Starting synthetic customer session...');await injectMessenger();await setCustomerData(customer,scenario,convo,queue);setProgress(8,'Sending first customer message...');
  await startCustomerConversation();await setCustomerData(customer,scenario,convo,queue);
  const firstId=await sendCustomer(convo.messages[0].text);await sleep(1200);let conversationId=await waitForConversationId();if(!conversationId&&firstId)conversationId=await getConversationFromMessage(firstId);if(!conversationId)throw new Error('Customer message was sent but the conversation ID could not be resolved. Check the Messenger deployment and Platform API permissions.');
  state.currentConversationId=conversationId;setProgress(18,'Waiting for agent assignment...');const assignment=await waitForAgentConversation(conversationId,agentId);if(!assignment)throw new Error('The conversation was not connected to the signed-in agent. Check Messenger routing, queue membership and agent status.');
  const total=convo.messages.length;for(let i=1;i<total;i++){const m=convo.messages[i];if($('includeTyping').checked)await sleep(m.delayMs??(m.speaker==='customer'?900:1100));if(m.speaker==='customer'){await sendCustomer(m.text)}else{await sendAgent(conversationId,assignment.communicationId,m.text)}setProgress(18+Math.round(((i+1)/total)*75),`${m.speaker==='customer'?'Customer':'Agent'} message ${i+1} of ${total}`)}
  if($('autoDisconnect').checked){await sleep(700);await disconnect(conversationId)}setProgress(100,$('autoDisconnect').checked?'Conversation created and disconnected.':'Conversation created.');setStatus('Created','live');return{conversationId,customer,scenario:scenario.name,conversation:convo.name,outcome:convo.outcome};
}
async function handleCreate(){const c=selectedConversation();if(!c)return;toggle(true);try{const r=await createConversation(c);state.created.unshift(r);renderHistory()}catch(e){console.error(e);setProgress(100,e.message);setStatus('Failed','warning')}finally{toggle(false)}}
async function handleBatch(){const s=selectedScenario();if(!s)return;toggle(true);try{for(const c of s.conversations.slice(0,3)){await createConversation(c);state.created.unshift({conversationId:state.currentConversationId,customer:c.customer,scenario:s.name,conversation:c.name,outcome:c.outcome});renderHistory();await sleep(700)}}catch(e){console.error(e);setStatus('Batch failed','warning');setProgress(100,e.message)}finally{toggle(false)}}
function toggle(disabled){$('createBtn').disabled=disabled;$('batchBtn').disabled=disabled}
function renderHistory(){if(!state.created.length){$('history').className='history-empty';$('history').textContent='No synthetic conversations created yet.';return}$('history').className='';$('history').innerHTML=state.created.map(x=>`<div class="history-item"><div class="history-main"><strong>${escapeHtml(x.scenario)} — ${escapeHtml(x.conversation)}</strong><div class="history-meta">${escapeHtml(x.outcome)} · ${escapeHtml(x.customer?.name||'Synthetic Customer')}</div></div><div class="history-id">${escapeHtml(x.conversationId||'')}</div></div>`).join('')}

async function boot(){
  $('loginRegion').value=state.config.region||'usw2.pure.cloud';$('oauthClientId').value=state.config.clientId||'';$('deploymentId').value=state.config.deploymentId||'';$('redirectUri').textContent=redirectUri();
  try{await handleOAuthCallback();restoreSession();if(!state.token)return;const [me,users,queues,scenarios]=await Promise.all([gcFetch('GET','/api/v2/users/me'),fetchEntities('/api/v2/users?state=active'),fetchEntities('/api/v2/routing/queues'),fetch('scenarios/scenarios.json').then(r=>r.json())]);state.user=me;state.users=users;state.queues=queues;state.scenarios=scenarios.scenarios||[];populate($('agentSelect'),users,'Select agent...',x=>`${x.name}${x.id===me.id?' (You)':''}`);$('agentSelect').value=me.id;populate($('queueSelect'),queues,'Select queue...');renderScenarioOptions();updateAgentNote();$('loginPanel').classList.add('hidden');$('app').classList.remove('hidden');$('loginBtn').classList.add('hidden');$('logoutBtn').classList.remove('hidden');$('identityBadge').textContent=me.name;$('identityBadge').className='badge live';
    // Load Messenger only when the first conversation is created, avoiding a customer session on page load.
  }catch(e){console.error(e);showLoginMessage(e.message)}
}

document.addEventListener('DOMContentLoaded',()=>{$('loginBtn').addEventListener('click',startLogin);$('logoutBtn').addEventListener('click',logout);$('scenarioSelect').addEventListener('change',renderConversationOptions);$('conversationSelect').addEventListener('change',renderPreview);$('agentSelect').addEventListener('change',updateAgentNote);$('createBtn').addEventListener('click',handleCreate);$('batchBtn').addEventListener('click',handleBatch);boot()});
