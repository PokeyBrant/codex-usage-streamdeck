# Privacy Policy

Codex Usage Monitor is a local Stream Deck plugin.

## Data Accessed

The plugin reads the local Codex authentication file on the user's computer:

- Windows: `%USERPROFILE%\.codex\auth.json`
- macOS: `~/.codex/auth.json`

The plugin uses the Codex access token and ChatGPT account id from that file to request Codex usage information from OpenAI/ChatGPT. If the access token is stale, it uses the refresh token from the same file to refresh the local Codex login.

## Data Sent

The plugin sends authenticated requests only to:

`https://chatgpt.com/backend-api/codex/usage`

The plugin does not send user data, tokens, usage data, analytics, or telemetry to the plugin author or any third party.

## Data Stored

The plugin stores only Stream Deck action settings, such as display mode, refresh interval, thresholds, and whether mood indicators are enabled.

The plugin does not store a copy of the Codex token.

## Token Handling

Tokens are not displayed in the UI, not logged, and not included in generated key images.

The plugin uses the Codex refresh token only when the access token is rejected as expired, and writes the refreshed tokens back to the local Codex auth file.
