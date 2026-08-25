# Marketplace Handoff

## Package

Built plugin installer:

`com.statuscheck.codex-usage.streamDeckPlugin`

Public release:

`https://github.com/statuscheckgg/codex-usage-streamdeck/releases/tag/v0.1.11`

Prepared upload candidate:

`0.1.12.0`

## Current Status

- Stream Deck validation passes.
- Plugin packages successfully.
- Runtime dependencies are bundled inside the plugin package.
- Users do not need npm, PowerShell, API Ninja, or a local server.
- Local WebSocket harness passes 41 usage, reset-detail, display-mode, status, error, refresh, and cached-rerender scenarios.
- The plugin has been installed into the local Stream Deck plugin directory and Stream Deck has been restarted.

## Listing Draft

Name:

`Codex Usage Monitor`

Short description:

`Track Codex limits, banked resets, and expiration details on Stream Deck.`

Description:

`Codex Usage Monitor is an unofficial local Stream Deck plugin for tracking Codex subscription capacity at a glance. It shows remaining or used percentages for the 5-hour and weekly limits, reports banked resets and current-usage applicability, and supports optional Spark or other model-specific limits when Codex reports them.

Choose Dual Bars, Ring Gauge, Warning Tile, Split Key, or the display-only Reset Details layout. Reset Details keeps the key uncluttered with one large banked-reset count and one expiration-date line, while the Property Inspector retains the fuller reset status. Configure the active quota, remaining-capacity thresholds, optional flicker, refresh interval, reset countdowns, banked-reset indicator, and 12 or 24-hour clock. Visual changes rerender cached data without another network request; the key refreshes on its timer, when pressed, or from the Property Inspector. It never applies or spends a reset.

Requires Stream Deck 7.1 or later, an active local Codex login, and network access to ChatGPT. End users do not need Node.js, npm, PowerShell, API Ninja, or a local server.

This plugin is unofficial and is not affiliated with OpenAI. It reads the local Codex auth file and sends authenticated usage requests only to OpenAI/ChatGPT. Tokens and raw usage data are never shown or sent to the plugin author, and the plugin includes no analytics or telemetry.`

Disclosure:

`This plugin is unofficial and is not affiliated with OpenAI. It reads the local Codex auth file to request usage from OpenAI/ChatGPT. Nothing is logged by the plugin, and usage checks do not consume Codex usage tokens.`

Optional support note:

`This plugin is free. If it saves you time, optional support is welcome.`

## Required Marketplace Assets

- Thumbnail: `1920x960 PNG`
- Minimum 3 gallery items: `1920x960 PNG` or `1920x1080 MP4`
- Public support URL
- Public privacy policy URL
- Release notes

Generated local assets:

- `marketplace-assets\thumbnail-1920x960.png`
- `marketplace-assets\gallery-dual-bars-green.png`
- `marketplace-assets\gallery-ring-warning.png`
- `marketplace-assets\gallery-property-inspector.png`
- `marketplace-assets\gallery-critical-state.png`
- `marketplace-assets\gallery-reset-details.png`
- `marketplace-assets\codex-usage-monitor-demo.mp4`

Public links:

- Support: `https://github.com/statuscheckgg/codex-usage-streamdeck/issues`
- Privacy: `https://github.com/statuscheckgg/codex-usage-streamdeck/blob/main/PRIVACY.md`
- Release notes: `https://github.com/statuscheckgg/codex-usage-streamdeck/blob/main/RELEASE_NOTES.md`
- Optional support: `https://buymeacoffee.com/statuscheck`

## Suggested Gallery Shots

- Dual bars normal green state
- Ring gauge warning state
- Warning and critical red state
- Property inspector settings
- Display-only reset details and expiration

## v0.1.12 Release Notes

`Adds banked-reset visibility, current-usage applicability, a positive R# key indicator, and a fifth display-only Reset Details layout reduced to a readable count and expiration date. Also refines the quota layouts, adds exact 12 or 24-hour timing, improves the Property Inspector status card, and rerenders cached visual changes without another network request.`

## Review Risks

- Uses two internal, read-only Codex/ChatGPT endpoints rather than a documented public API.
- Reads local Codex auth, so the listing and property inspector must clearly disclose token handling.
- Windows is live-validated. macOS 13+ remains included in the manifest but unverified and must not be described as tested.

## Submission Status

- GitHub repo published.
- GitHub v0.1.11 is public and Marketplace v0.1.11 was previously submitted for review.
- Local v0.1.12 source and listing copy are updated; regenerated package and media validation are still required before upload.
- Elgato `streamdeck validate` passes after public URL resolution.
- Current upload copy and checklist are in `SUBMISSION.md`; `ELGATO_REVIEW_RESPONSE.md` is retained only as historical context.
