# Codex Usage Monitor for Stream Deck

Unofficial local Stream Deck plugin for monitoring Codex usage windows.

The plugin displays Codex usage from the local Codex login:

- 5-hour usage window
- Weekly usage window
- Reset countdowns
- Banked reset count, current-usage applicability, and reset expiration details
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
- Reset details

The Property Inspector reports banked resets, whether the current usage is eligible to benefit from one, the nearest reset expiration, refresh status, and the last successful update. It also includes refresh interval, conditional single-icon targeting, remaining-capacity thresholds, reset-label controls, optional 24-hour clock formatting, and Spark availability.

When a reset is banked, the quota layouts can append `R#` to the active reset countdown. The **Show banked resets** setting hides that indicator independently of reset countdowns. The dedicated Reset Details mode is deliberately minimal and shows only the banked `R#` count and expiration date. Every layout is display-only: pressing the key refreshes the data and never applies or spends a reset.

## Security Model

This plugin reads the user's local Codex auth file:

- Windows: `%USERPROFILE%\.codex\auth.json`
- macOS: `~/.codex/auth.json`

It uses the stored Codex ChatGPT access token and account id to make two read-only requests:

`https://chatgpt.com/backend-api/wham/usage`

`https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

Tokens are not displayed, logged, or sent anywhere except OpenAI/ChatGPT.

The plugin does not call a reset-consumption endpoint and cannot apply a banked reset.

The plugin does not use the refresh token. If the access token is stale, the key shows a login/auth state and the user should refresh their Codex login through Codex itself.

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
