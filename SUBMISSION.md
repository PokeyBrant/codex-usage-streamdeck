# Elgato Marketplace Upload Candidate

## Product

- Name: `Codex Usage Monitor`
- Type: Stream Deck plugin
- Version: `0.1.12.0`
- Price: Free
- Author: `Status Check`
- Plugin file: `com.statuscheck.codex-usage.streamDeckPlugin`
- Validated live platform: Windows 10+
- Manifest platforms: Windows 10+ and macOS 13+
- macOS status: Included but not live-validated; do not describe it as tested

## Short Description

Track Codex limits, banked resets, and expiration details on Stream Deck.

## Description

Codex Usage Monitor is an unofficial local Stream Deck plugin for tracking Codex subscription capacity at a glance. It shows remaining or used percentages for the 5-hour and weekly limits, reports banked resets and current-usage applicability, and supports optional Spark or other model-specific limits when Codex reports them.

Choose Dual Bars, Ring Gauge, Warning Tile, Split Key, or the display-only Reset Details layout. Reset Details keeps the key uncluttered with one large banked-reset count and one expiration-date line, while the Property Inspector retains the fuller reset status. Configure the active quota, remaining-capacity thresholds, optional flicker, refresh interval, reset countdowns, banked-reset indicator, and 12 or 24-hour clock. Visual changes rerender cached data without another network request; the key refreshes on its timer, when pressed, or from the Property Inspector. It never applies or spends a reset.

Requires Stream Deck 7.1 or later, an active local Codex login, and network access to ChatGPT. End users do not need Node.js, npm, PowerShell, API Ninja, or a local server.

This plugin is unofficial and is not affiliated with OpenAI. It reads the local Codex auth file and sends authenticated usage requests only to OpenAI/ChatGPT. Tokens and raw usage data are never shown or sent to the plugin author, and the plugin includes no analytics or telemetry.

## Release Notes

- Added banked-reset and current-usage applicability status.
- Added a fifth, display-only Reset Details layout reduced to a large banked count and readable local expiration date.
- Added an optional positive banked `R#` key indicator without displaying `R0` or attaching resets to Spark.
- Refined Dual Bars, Ring Gauge, Split Key, and Warning Tile layouts for clearer hardware readability.
- Added full Warning Tile labels, verbose reset duration, exact local reset time, and optional 24-hour formatting.
- Added a live Property Inspector status card and cached rerendering for visual-only settings changes.

## Upload Files

- Product: `com.statuscheck.codex-usage.streamDeckPlugin`
- App icon: `marketplace-assets\icon-288x288.png`
- Thumbnail: `marketplace-assets\thumbnail-1920x960.png`
- Gallery 1: `marketplace-assets\gallery-dual-bars-green.png`
- Gallery 2: `marketplace-assets\gallery-ring-warning.png`
- Gallery 3: `marketplace-assets\gallery-property-inspector.png`
- Gallery 4: `marketplace-assets\gallery-critical-state.png`
- Gallery 5: `marketplace-assets\gallery-reset-details.png`
- Demo video: `marketplace-assets\codex-usage-monitor-demo.mp4`

## Links

- Product: `https://github.com/statuscheckgg/codex-usage-streamdeck`
- Support: `https://github.com/statuscheckgg/codex-usage-streamdeck/issues`
- Privacy: `https://github.com/statuscheckgg/codex-usage-streamdeck/blob/main/PRIVACY.md`
- Release notes: `https://github.com/statuscheckgg/codex-usage-streamdeck/blob/main/RELEASE_NOTES.md`
- Optional support: `https://buymeacoffee.com/statuscheck`

## Reviewer Notes

- Uses two internal, read-only Codex/ChatGPT endpoints, `https://chatgpt.com/backend-api/wham/usage` and `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`, not a documented public OpenAI API.
- Reads the existing local Codex auth file but does not log, display, persist, or forward tokens.
- Does not use the refresh token and does not apply a banked reset or call an undocumented write endpoint.
- Property Inspector receives only normalized status and never receives raw usage, account data, auth paths, or tokens.
- The demo video contains no user account data, tokens, or real usage payloads.

## Pre-Upload Checklist

- [ ] Commit and push v0.1.12 source, support, privacy, and release notes so public links match the candidate.
- [ ] Confirm Maker Console v0.1.11 review state before adding v0.1.12 as a new version.
- [ ] Upload the v0.1.12 product file, 288×288 icon, 1920×960 thumbnail, and at least three gallery items.
- [ ] Include the 1920×1080 MP4 demonstration video because the plugin integrates with a paid service.
- [ ] Paste the description and release notes above without claiming macOS was tested.
- [ ] Leave automatic publication disabled until the DRM-protected candidate has been downloaded and smoke-tested.
- [ ] Submit for Elgato review only after explicit user approval.
