# Release Notes

## 0.1.11.0

- Supports temporary removal of the five-hour Codex limit without showing an API changed warning.
- Identifies five-hour and weekly quotas by window duration instead of response field position.
- Shows unavailable quota windows as a green `OPEN` state while preserving available usage, reset, threshold, and flicker behavior.
- Handles weekly-only Spark limits and safely ignores banked-reset metadata until it is exposed as a user-facing feature.
- Preserves the improved spacing between three-digit percentages and quota labels.

## 0.1.7.0

- Makes the single-icon display selector explicit: auto lowest remaining, 5-hour, or weekly.
- Removes mood icon rendering and plan-label rendering from Stream Deck keys.

## 0.1.6.0

- Increases quota-window labels and reset countdown text size for better readability on hardware keys.

## 0.1.5.0

- Updates the app/plugin icon to match the live dual-bars Stream Deck key display.

## 0.1.4.0

- Declares Stream Deck manifest SDK version 3 for Maker Console compatibility.
- Keeps the official `@elgato/streamdeck` v2 runtime bundle and Stream Deck 7.1 / Node 24 requirements.

## 0.1.3.0

- Removes redundant weekly-tile and lowest-remaining display modes.
- Keeps legacy saved settings working by mapping old weekly-tile keys to weekly ring gauge and old lowest keys to auto ring gauge.

## 0.1.2.0

- Adds a Single display selector for one-window modes: Auto, 5-hour, or Weekly.
- Lets ring gauge and warning tile target either quota window.

## 0.1.1.0

- Bundles the official Stream Deck SDK runtime for Marketplace compatibility.
- Colors 5-hour and weekly quota indicators independently in dual-bar and split views.

## 0.1.0.0

Initial release.

- Display Codex 5-hour and weekly usage windows on a Stream Deck key.
- Show remaining or used percentage.
- Initial visual modes included dual bars, ring gauge, weekly tile, warning tile, split key, and lowest remaining.
- Add configurable thresholds, reset countdowns, and optional mood/status indicators.
- Add login, auth-expired, network, and endpoint-changed error states.
- Read the existing local Codex login from `~/.codex/auth.json`.
- Send authenticated usage requests only to OpenAI/ChatGPT.
- No API Ninja, PowerShell, npm, or local server required for end users.
