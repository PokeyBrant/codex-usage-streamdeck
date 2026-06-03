# Codex Usage Monitor for Stream Deck

Unofficial local Stream Deck plugin for monitoring Codex usage windows.

The plugin displays Codex usage from the local Codex login:

- 5-hour usage window
- Weekly usage window
- Reset countdowns
- Optional extra model-specific limits such as Spark
- Configurable visual modes, thresholds, and reset labels

## User Experience

Users should not need Node.js, npm, Stream Deck CLI, PowerShell, API Ninja, or a local bridge server.

Expected setup:

1. Install the plugin from Marketplace.
2. Drag `Codex Usage` onto a key.
3. Sign into Codex normally if needed.
4. The key displays current usage.

## Install For Testing

Download the latest `.streamDeckPlugin` file from the GitHub releases page, then double-click it to install into Stream Deck.

## Display Modes

- Dual bars
- Ring gauge
- Warning tile
- Split key

The Property Inspector also includes refresh interval, single-icon target, threshold, reset-label, and Spark-limit controls.

## Security Model

This plugin reads the user's local Codex auth file:

- Windows: `%USERPROFILE%\.codex\auth.json`
- macOS: `~/.codex/auth.json`

It uses the stored Codex ChatGPT access token and account id to request:

`https://chatgpt.com/backend-api/codex/usage`

Tokens are not displayed, logged, or sent anywhere except OpenAI/ChatGPT.

If the access token is stale, the plugin uses the stored Codex refresh token to refresh the local login and writes the updated tokens back to `auth.json`.

## Development

Check syntax:

```powershell
npm run check
```

Validate:

```powershell
npm run validate
```

Package:

```powershell
npm run pack
```

## Marketplace Notes

This is an unofficial plugin and should not imply affiliation with OpenAI.

The Marketplace listing and property inspector must disclose that the plugin reads local Codex auth and calls OpenAI/ChatGPT usage endpoints.

## Support

Use GitHub issues for support:

https://github.com/statuscheckgg/codex-usage-streamdeck/issues

This plugin is free, with no paywall. If it saves you time, optional support is welcome:

https://buymeacoffee.com/statuscheck
