Replace your existing app.js with this file.

Important: for a Messenger configuration with Automatically Start Conversations enabled, the app now uses MessagingService.joinConversation and does NOT call configureConversation first. For auto-start disabled, it falls back to configureConversation and lets the first sendMessage start the customer conversation.

Hard refresh the GitHub Pages site before testing.
