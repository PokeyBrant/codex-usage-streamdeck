# Privacy Policy

Codex Usage Monitor is a local Stream Deck plugin.

## Data Accessed

The plugin reads the local Codex authentication file on the user's computer:

- Windows: `%USERPROFILE%\.codex\auth.json`
- macOS: `~/.codex/auth.json`

The plugin uses the Codex access token and ChatGPT account id from that file to request Codex usage and banked-reset details from OpenAI/ChatGPT.

## Data Sent

The plugin sends authenticated requests only to:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

The plugin does not send user data, tokens, usage data, analytics, or telemetry to the plugin author or any third party.

Both requests are read-only. The plugin does not call a reset-consumption endpoint and cannot apply or spend a reset.

## Data Stored

The plugin stores only Stream Deck action settings, such as display mode, refresh interval, thresholds, reset visibility, flicker intervals, and 12 or 24-hour clock preference.

The plugin does not store a copy of the Codex token.

## Token Handling

Tokens are not displayed in the UI, not logged, and not included in generated key images.

The plugin does not use the Codex refresh token. If authentication expires, the user must refresh their Codex login through Codex.
