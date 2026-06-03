# Codex Usage Monitor Support

## First Checks

If the key shows `LOGIN CODEX`, open Codex or run `codex login`, then press the Stream Deck key to refresh.

If the key shows `AUTH EXPIRED`, press the key once to retry. If it remains expired, refresh the normal Codex login because the refresh token may also be expired or revoked.

If the key shows `NETWORK RETRY`, confirm the machine can reach `https://chatgpt.com`.

If the key shows `API CHANGED`, the internal Codex usage endpoint or response shape may have changed.

## Plugin Behavior

- The plugin reads `~/.codex/auth.json`.
- It sends usage requests only to `https://chatgpt.com/backend-api/codex/usage`.
- It does not display, log, store, or transmit tokens to the plugin author.
- End users do not need npm, PowerShell, API Ninja, or a local server.

## Useful Debug Info

- Plugin UUID: `com.statuscheck.codex-usage`
- Action UUID: `com.statuscheck.codex-usage.usage`
- Current version: `0.1.7.0`
- Local Stream Deck plugin folder on Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\com.statuscheck.codex-usage.sdPlugin`

## Optional Support

Codex Usage Monitor is free, with no paywall. If it saves you time, optional support is welcome:

https://buymeacoffee.com/statuscheck
