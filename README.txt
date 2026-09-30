GENESYS SYNTHETIC CONVERSATIONS - V3

This build removes the invalid session-mode fallback that caused the repeated "There is already an active conversation" error.

GENESYS CONFIGURATION FOR THIS MVP
- Messenger native UI: OFF (Headless/custom client)
- Automatically Start Conversations: OFF
- Launcher: Hidden
- Deployment: Active, assigned to a published inbound message flow
- Architect first-test flow: Start -> Transfer to ACD -> RB_Inbound_Message_Q
- Do not send an automatic Architect greeting during the first test.

APP SEQUENCE
1. Load headless Messenger
2. Clear any previous session
3. configureConversation once
4. Set synthetic customer attributes
5. sendMessage for the first customer turn
6. Resolve the actual message ID returned by sendMessage, if exposed
7. Only then proceed to the agent-side API path

The previous build incorrectly used messagesReceived as if it were the customer's own outbound message identifier, and it used an invalid join->configure fallback. This version removes both behaviours.
