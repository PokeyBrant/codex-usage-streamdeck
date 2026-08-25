# Elgato Review Response Materials

> Historical response for the earlier submission review. Use `SUBMISSION.md` for the current v0.1.12 upload candidate.

## Summary

Elgato requested three revisions for Codex Usage Monitor:

- Add more product-functionality detail to the description.
- Update product media to avoid overlapping text and imagery.
- Send a short demo video to `maker@elgato.com`.

The revised materials are prepared locally and ready for resubmission.

## Updated Description

Codex Usage Monitor is an unofficial local Stream Deck plugin that shows current Codex usage directly on a Stream Deck key. It uses the existing local Codex login to request usage data from ChatGPT, then displays remaining or used percentage for the 5-hour and weekly Codex usage windows.

The key refreshes automatically at a configurable interval and can also be refreshed manually by pressing the key. Display modes include dual bars for both quota windows, a ring gauge, a warning tile, and a split-key view. Single-window modes can show the lowest remaining window automatically or be locked to the 5-hour or weekly window.

Users can configure visual mode, remaining/used percentage basis, single-icon target, refresh timing, threshold colors, reset countdown labels, and optional Spark/model-specific limit display.

The plugin includes clear status screens for first-run and error states, including Login Codex, Auth Expired, Network Retry, and API Changed.

This plugin is unofficial and is not affiliated with OpenAI. It reads the local Codex auth file to request usage from OpenAI/ChatGPT. Nothing is logged by the plugin, and usage checks do not consume Codex usage tokens.

## Updated Media Files

Use these revised files in Maker Console:

- Icon: `marketplace-assets\icon-288x288.png`
- Thumbnail: `marketplace-assets\thumbnail-1920x960.png`
- Gallery: `marketplace-assets\gallery-dual-bars-green.png`
- Gallery: `marketplace-assets\gallery-ring-warning.png`
- Gallery: `marketplace-assets\gallery-property-inspector.png`
- Gallery: `marketplace-assets\gallery-critical-state.png`

The gallery images were regenerated with shorter text and separated text/visual areas to avoid overlapping information.

## Demo Video

Send this file to `maker@elgato.com`:

`marketplace-assets\codex-usage-monitor-demo.mp4`

Video details:

- Format: MP4 / H.264
- Resolution: 1920x1080
- Duration: 19 seconds
- No audio

## Reply Email Draft

Subject: Codex Usage Monitor review updates and demo video

Hi Elgato Maker team,

Thank you for the review feedback. I have updated the Codex Usage Monitor submission with the requested changes:

- Expanded the product description to explain the plugin functionality, display modes, refresh behavior, configurable settings, status/error states, and privacy/auth handling.
- Replaced the product media with revised images that keep text and visuals separated to avoid overlapping information.
- Prepared a short demo video showing the main display states, visual modes, Property Inspector configuration, and low-limit state.

The revised product page has been updated in Maker Console. I have attached the requested demo video: `codex-usage-monitor-demo.mp4`.

Please let me know if anything else is needed for review.

Thanks,
Status Check
