# Genesys Synthetic Conversations - Login Fix

This patch replaces the hand-written OAuth token exchange with the official Genesys Cloud JavaScript Platform SDK `loginPKCEGrant()` browser flow.

## Replace

Copy `index.html` and `app.js` into the GitHub Pages repository, replacing the existing files. Keep `styles.css` and `scenarios/` as they are.

## OAuth client

Use a Genesys Cloud OAuth client configured for **Code Authorization / PKCE**. Add the exact GitHub Pages URL shown on the page to the OAuth client's Authorized redirect URIs.

Example:
`https://<username>.github.io/<repository>/`

No client secret is used by this browser application.

## Login

Enter:
- Region
- OAuth client ID
- Messenger deployment ID (only required later for conversation creation)

Click **Sign in with Genesys**.

The SDK handles the browser PKCE exchange. The access token is kept in the SDK's in-memory client for the current page session; the app does not write an access token or client secret into localStorage.

The SDK version is intentionally pinned to 263.1.0 rather than `latest` because Genesys has recently had CDN cache/version inconsistencies with the `latest` tag.
