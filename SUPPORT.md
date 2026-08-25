# Codex Usage Monitor Support

## First Checks

If the key shows `LOGIN CODEX`, open Codex or run `codex login`, then press the Stream Deck key to refresh.

If the key shows `AUTH EXPIRED`, refresh the normal Codex login. The plugin does not refresh tokens directly.

If the key shows `NETWORK RETRY`, confirm the machine can reach `https://chatgpt.com`.

If the key shows `API CHANGED`, the internal Codex usage endpoint or response shape may have changed.

## Plugin Behavior

- The plugin reads `~/.codex/auth.json`.
- It sends read-only requests only to `https://chatgpt.com/backend-api/wham/usage` and `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`.
- It cannot apply or spend a reset. Pressing the key only refreshes displayed data.
- It does not display, log, store, or transmit tokens to the plugin author.
- End users do not need npm, PowerShell, API Ninja, or a local server.

## Useful Debug Info

- Plugin UUID: `com.statuscheck.codex-usage`
- Action UUID: `com.statuscheck.codex-usage.usage`
- Current version: `0.1.12.0`
- Local Stream Deck plugin folder on Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\com.statuscheck.codex-usage.sdPlugin`

## Optional Support

Codex Usage Monitor is free, with no paywall. If it saves you time, optional support is welcome:

https://buymeacoffee.com/statuscheck
