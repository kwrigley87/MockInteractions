# Genesys Synthetic Conversations

A demo/test utility that creates realistic **real Genesys Cloud messaging conversations** from a reusable scenario library.

## What this version does

- Uses **OAuth Authorization Code + PKCE** for the human operator login.
- Keeps the service client secret strictly server-side.
- Injects the customer side through the current **Open Messaging inbound message** endpoint:
  `/api/v2/conversations/messages/{integrationId}/inbound/open/message`
- Routes the interaction through the org's Open Messaging / Architect configuration.
- Uses the signed-in Genesys user context to send actual agent-side messages on the connected messaging communication.
- Can disconnect the interaction after the final message.
- Includes a library of 8 scenarios / 24 variants with different sentiment, intents, outcomes and coaching signals.
- Supports one conversation or the first 3 variants of a scenario.

## Important architecture/security point

There are intentionally **two OAuth identities**:

1. **PKCE client**: used by the browser to sign the human operator in. It is a public client ID; there is no client secret in the browser.
2. **Service client**: Client Credentials grant used only by the Node server to send synthetic customer messages. The client secret lives only in `.env` / the server environment.

Do not put `GENESYS_SERVICE_CLIENT_SECRET` into GitHub Pages or any file under `public/`.

## Genesys setup

### 1. Create the PKCE OAuth client

In Genesys Cloud:

`Admin -> Integrations -> OAuth -> Add Client`

Use **Authorization Code / PKCE**.

Add the exact URL where this app is hosted to the authorized redirect URIs. For local testing:

`http://localhost:3000/`

For GitHub Pages, use the exact Pages URL including the trailing `/`.

Minimum browser scopes used by this app:

- `conversations`
- `users:readonly`
- `routing:readonly`
- `analytics:readonly`

### 2. Create the service OAuth client

Create a separate **Client Credentials** OAuth client.

Give it the minimum role permissions required for the Open Messaging inbound endpoint in your org. Genesys documentation notes that Open Messaging inbound calls use client-credential authentication and appropriate messaging permissions.

Keep the Client ID and Client Secret only on the server.

### 3. Create/configure Open Messaging

Create an Open Messaging integration and copy its integration ID.

The integration should have an outbound notification webhook configured according to your normal Open Messaging design. The important point for this tool is that inbound Open Messages must be routed to an Architect Inbound Message Flow / queue.

A typical routing path is:

`Open Messaging integration -> Inbound Message Flow -> Queue -> Agent`

Make sure the selected demo agent is on the queue and can accept message interactions.

## Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```text
GENESYS_REGION=usw2.pure.cloud
GENESYS_PKCE_CLIENT_ID=your-pkce-client-id
GENESYS_SERVICE_CLIENT_ID=your-service-client-id
GENESYS_SERVICE_CLIENT_SECRET=your-service-client-secret
GENESYS_OPEN_MESSAGING_INTEGRATION_ID=your-open-messaging-integration-id
APP_ORIGIN=http://localhost:3000
```

Run:

```bash
npm start
```

Open:

`http://localhost:3000/`

## Agent behaviour

The tool creates the customer message via the service identity, but it sends the **agent responses using the logged-in Genesys user context**. This is deliberate: agent-side message APIs operate in the context of the active agent communication.

For the cleanest demo, sign in as the agent you want to use and keep that user selected in the Agent field.

If the interaction lands in the queue but the agent does not become connected, check:

- the selected user is on the queue;
- the user is available / On Queue;
- the Architect inbound message flow routes to the expected queue;
- the Open Messaging integration is the integration ID configured in `.env`;
- the agent has the required conversation/message permissions.

## Scenario library

The library is deliberately data-driven. Edit `scenarios/scenarios.json` to add or change scenarios without changing application code.

Each conversation supports:

- customer profile
- characteristics/tags
- outcome
- ordered speaker turns
- optional `delayMs` per message

Useful scenario characteristics already included include:

- negative / positive sentiment
- competitor mention
- price objection
- retention save
- repeat contact
- empathy opportunity
- upsell opportunity
- complaint escalation
- compliance risk
- privacy/security
- sentiment recovery
- coaching opportunity

## Current API/deprecation notes

This app does **not** use the old ACD Web Chat APIs. Those APIs were removed in 2026, with Genesys directing implementations toward Web Messaging / Messenger.

It also does not use the deprecated catch-all Open Messaging inbound endpoint. The app targets the replacement integration-specific inbound message endpoint and is therefore designed around the current Open Messaging model.

As of September 29, 2026, Genesys has announced October 5, 2026 as the removal date for the old catch-all Open Messaging endpoint. This project deliberately avoids it.

## Known limitation / next iteration

The current POC does not automatically force an arbitrary selected agent to send messages while authenticated as a different user. The agent message endpoint is used in the signed-in user's context. This is normally what you want for a demo: sign in as the demo agent and create multiple conversations for that user.

A future server-side impersonation variant can be added if an org explicitly wants an administrator/operator to create conversations that appear to have been sent by another agent and has the appropriate Genesys permissions for message impersonation.
