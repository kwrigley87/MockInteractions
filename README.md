# Genesys Synthetic Conversations - Static GitHub Pages MVP

This version is designed specifically for the intended deployment model: **GitHub Pages only**, embedded as a custom app/widget in Genesys Cloud.

## Architecture

The app has two identities, but neither requires a server:

1. **Operator / agent:** the app uses Genesys Cloud Authorization Code + PKCE. The user signs in to Genesys Cloud, and the resulting user access token is held in `sessionStorage` for the browser session.
2. **Synthetic customer:** the app uses the Genesys Cloud **Messenger / Web Messaging SDK** as an end-user client. The Messenger SDK manages the customer-side web-messaging session without a Genesys Cloud Platform API client secret.

This is deliberately different from using the Open Messaging inbound Platform API. The current Open Messaging inbound message API requires an OAuth client-credentials token with messaging scope, and client credentials must not be placed in a browser app. Genesys explicitly restricts client-credentials usage from browser apps for this reason.

The end result is:

`Synthetic customer (Web Messaging SDK) -> Messenger routing -> selected/signed-in agent -> real agent messages via user OAuth -> disconnect`

## Why there is no Node server

For your intended MVP, a Node server would add infrastructure purely to protect a Client Credentials secret. GitHub Pages cannot safely host that secret.

Instead, the customer side behaves like a real web-messaging visitor. `MessagingService.sendMessage` creates actual customer messages in the Web Messaging conversation. Genesys documents this command as sending a message from the end user, and the Messenger SDK can run in headless/custom-UI mode.

## Genesys setup

### 1. Create a PKCE OAuth client

Admin -> Integrations -> OAuth -> Add Client

Use **Authorization Code / PKCE**.

Add this exact redirect URI:

`https://<username>.github.io/<repository>/`

Use the minimum scopes needed for the app. The current build calls:

- `users:readonly`
- `routing:readonly`
- `conversations`

The OAuth client ID is not a secret. Do not add a client secret to this repository.

### 2. Create a Messenger deployment

Create or use a Genesys Cloud **Messenger Deployment** configured to route Web Messaging conversations to your demo queue / inbound message flow.

Copy the Deployment ID into the application login screen.

The deployment ID is configuration, not a secret.

### 3. Routing to a specific agent

Messenger routing normally determines the queue / flow. This app therefore works best when the signed-in demo user is on the queue and can receive the interaction.

The app also sets synthetic participant custom attributes including:

- `syntheticDemo`
- `scenario`
- `conversationVariant`
- `syntheticOutcome`
- `syntheticCustomerId`
- `syntheticCustomerName`
- `syntheticTargetQueueId`

You can use these in an Architect inbound-message flow later for more sophisticated routing or scenario-dependent behaviour.

## Login

On the connection screen enter:

- Genesys Cloud region
- OAuth client ID
- Messenger deployment ID

The region and client ID approach is intentionally copied conceptually from the QM Dashboard design. The client ID is stored as non-secret preference data. PKCE verifier/state values are stored only in `sessionStorage` during the OAuth transaction.

## How a generated conversation works

1. The app signs in the operator with PKCE.
2. The operator selects a scenario and conversation variant.
3. The app loads Messenger only when a conversation is created.
4. The app clears any previous synthetic Messenger conversation.
5. `MessagingService.startConversation` opens a new customer session.
6. Customer metadata is staged with `Database.set`.
7. `MessagingService.sendMessage` sends the customer message.
8. The app resolves the resulting Genesys conversation ID through the signed-in user's Platform API access.
9. The app waits for the agent communication to connect.
10. Customer turns use the Messenger end-user channel.
11. Agent turns use the authenticated user's messaging communication API.
12. The app disconnects the conversation when requested.

## Scenario library

All content is in `scenarios/scenarios.json`.

Current library:

- 8 scenario families
- 24 variants
- 186 message turns

The data model supports:

- customer profile
- characteristics / coaching signals
- outcome
- ordered speaker turns
- per-turn delay
- scenario metadata

Add or modify conversations by editing the JSON. No application code needs changing for normal scenario-library edits.

## GitHub Pages

Upload the repository contents to GitHub and enable Pages from the repository's branch/root.

There is no build step and no server process.

## Important limitation

The application can automate agent responses only for the **signed-in user context**. This is a Genesys API security boundary: the endpoint for sending messages on a connected agent communication requires a user-context token, not a Client Credentials token, and the user must be a participant in the conversation.

Therefore the intended demo flow is:

`Sign in as Agent A -> create scenarios -> Agent A handles the generated interactions`

A future server/service-account design could support administrator-driven automation across arbitrary agent identities, but that is deliberately not part of this static MVP.

## Current API / deprecation position

Do not use the deprecated catch-all Open Messaging endpoint:

`POST /api/v2/conversations/messages/inbound/open`

Genesys has replacement integration-specific endpoints and has announced October 5, 2026 as the removal date for the old catch-all endpoint.

This static MVP avoids that dependency entirely by using the current Messenger / Web Messaging SDK for the customer side.
