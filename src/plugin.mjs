#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import streamDeck, { SingletonAction } from "@elgato/streamdeck";

const PLUGIN_UUID = "com.statuscheck.codex-usage";
const ACTION_UUID = "com.statuscheck.codex-usage.usage";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const PLUGIN_VERSION = "0.1.11.0";
const FIVE_HOUR_MAX_SECONDS = 24 * 60 * 60;
const WEEKLY_MIN_SECONDS = 3 * 24 * 60 * 60;

const actions = new Map();

class CodexUsageAction extends SingletonAction {
  constructor() {
    super();
    this.manifestId = ACTION_UUID;
  }

  async onWillAppear(ev) {
    const context = ev.action.id;
    const settings = normalizeSettings(ev.payload?.settings);
    actions.set(context, {
      context,
      sdkAction: ev.action,
      settings,
      refreshTimer: null,
      flickerTimer: null,
      flickerOn: false,
      lastUsage: null,
      lastError: null,
    });
    scheduleRefresh(context);
    await refreshAction(context, { force: true });
  }

  onWillDisappear(ev) {
    const action = actions.get(ev.action.id);
    clearActionTimers(action);
    actions.delete(ev.action.id);
  }

  async onKeyDown(ev) {
    await refreshAction(ev.action.id, { force: true, feedback: true });
  }

  async onDidReceiveSettings(ev) {
    const context = ev.action.id;
    const settings = normalizeSettings(ev.payload?.settings);
    const action = actions.get(context) || {
      context,
      sdkAction: ev.action,
      refreshTimer: null,
      flickerTimer: null,
      flickerOn: false,
      lastUsage: null,
      lastError: null,
    };
    action.sdkAction = ev.action;
    action.settings = settings;
    actions.set(context, action);
    scheduleRefresh(context);
    await refreshAction(context, { force: true });
  }

  async onSendToPlugin(ev) {
    if (ev.payload?.type === "refresh") {
      await refreshAction(ev.action.id, { force: true, feedback: true });
    }
  }
}

streamDeck.actions.registerAction(new CodexUsageAction());

const runtimeKeepAlive = setInterval(() => {}, 60 * 60 * 1000);

main();

async function main() {
  try {
    await streamDeck.connect();
  } catch (error) {
    clearInterval(runtimeKeepAlive);
    streamDeck.logger.error("Failed to connect Codex Usage Monitor.", error);
    process.exit(1);
  }
}

function scheduleRefresh(context) {
  const action = actions.get(context);
  if (!action) {
    return;
  }

  if (action.refreshTimer) {
    clearInterval(action.refreshTimer);
    action.refreshTimer = null;
  }

  const refreshMs = Math.max(15, action.settings.refreshSeconds) * 1000;
  action.refreshTimer = setInterval(() => {
    refreshAction(context, { force: true }).catch(() => {});
  }, refreshMs);
}

function clearActionTimers(action) {
  if (!action) {
    return;
  }
  if (action.refreshTimer) {
    clearInterval(action.refreshTimer);
    action.refreshTimer = null;
  }
  if (action.flickerTimer) {
    clearInterval(action.flickerTimer);
    action.flickerTimer = null;
  }
}

function stopFlicker(action) {
  if (!action) {
    return;
  }
  if (action.flickerTimer) {
    clearInterval(action.flickerTimer);
    action.flickerTimer = null;
  }
  action.flickerOn = false;
}

function scheduleFlicker(context) {
  const action = actions.get(context);
  if (!action?.lastUsage || action.lastError) {
    stopFlicker(action);
    return;
  }

  stopFlicker(action);
  const snapshot = makeSnapshot(action.lastUsage, action.settings);
  const level = activeDisplayLevel(snapshot, action.settings);
  const config = flickerConfig(action.settings, level);
  if (!config?.enabled) {
    return;
  }

  const intervalMs = clampNumber(config.seconds, 2, 1, 30) * 1000;
  action.flickerTimer = setInterval(() => {
    const current = actions.get(context);
    if (!current?.lastUsage || current.lastError) {
      stopFlicker(current);
      return;
    }
    current.flickerOn = !current.flickerOn;
    renderAction(current, current.lastUsage).catch(() => {});
  }, intervalMs);
}

async function refreshAction(context, options = {}) {
  const action = actions.get(context);
  if (!action) {
    return;
  }

  try {
    const usage = await fetchCodexUsage(action.settings);
    action.lastUsage = usage;
    action.lastError = null;
    action.flickerOn = false;
    await renderAction(action, usage);
    scheduleFlicker(context);
    if (options.feedback) {
      await action.sdkAction.showOk();
    }
  } catch (error) {
    action.lastError = error;
    action.lastUsage = null;
    stopFlicker(action);
    await renderError(action, error);
    if (options.feedback) {
      await action.sdkAction.showAlert();
    }
  }
}

function defaultSettings() {
  return {
    displayMode: "dual-bars",
    refreshSeconds: 300,
    yellowThreshold: 50,
    redThreshold: 20,
    criticalThreshold: 10,
    yellowFlicker: false,
    yellowFlickerSeconds: 4,
    redFlicker: false,
    redFlickerSeconds: 2,
    criticalFlicker: false,
    criticalFlickerSeconds: 1,
    showReset: true,
    authPath: "",
    basis: "remaining",
    singleWindow: "auto",
  };
}

function normalizeSettings(raw = {}) {
  const defaults = defaultSettings();
  const legacyDisplayMode = pick(raw.displayMode, defaults.displayMode);
  return {
    displayMode: normalizeDisplayMode(legacyDisplayMode),
    refreshSeconds: clampNumber(raw.refreshSeconds, defaults.refreshSeconds, 15, 3600),
    yellowThreshold: clampNumber(raw.yellowThreshold, defaults.yellowThreshold, 1, 99),
    redThreshold: clampNumber(raw.redThreshold, defaults.redThreshold, 1, 99),
    criticalThreshold: clampNumber(raw.criticalThreshold, defaults.criticalThreshold, 1, 99),
    yellowFlicker: toBool(raw.yellowFlicker, defaults.yellowFlicker),
    yellowFlickerSeconds: clampNumber(raw.yellowFlickerSeconds, defaults.yellowFlickerSeconds, 1, 30),
    redFlicker: toBool(raw.redFlicker, defaults.redFlicker),
    redFlickerSeconds: clampNumber(raw.redFlickerSeconds, defaults.redFlickerSeconds, 1, 30),
    criticalFlicker: toBool(raw.criticalFlicker, defaults.criticalFlicker),
    criticalFlickerSeconds: clampNumber(raw.criticalFlickerSeconds, defaults.criticalFlickerSeconds, 1, 30),
    showReset: toBool(raw.showReset, defaults.showReset),
    authPath: typeof raw.authPath === "string" ? raw.authPath.trim() : defaults.authPath,
    basis: pick(raw.basis, defaults.basis),
    singleWindow: normalizeSingleWindow(raw.singleWindow, legacyDisplayMode, defaults.singleWindow, raw.showSpark),
  };
}

function pick(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeDisplayMode(value) {
  if (value === "dual-bars" || value === "ring" || value === "warning-tile" || value === "split") {
    return value;
  }
  if (value === "weekly-tile" || value === "lowest") {
    return "ring";
  }
  return "dual-bars";
}

function normalizeSingleWindow(value, displayMode, fallback, legacyShowSpark = false) {
  if (value === "primary" || value === "weekly" || value === "auto" || value === "spark") {
    return value;
  }
  if (toBool(legacyShowSpark, false)) {
    return "spark";
  }
  if (displayMode === "weekly-tile") {
    return "weekly";
  }
  return fallback;
}

function toBool(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "true" || value === "1" || value === "on";
  }
  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

async function fetchCodexUsage(settings) {
  if (process.env.CODEX_USAGE_MOCK_ERROR) {
    const err = new Error(`Mock ${process.env.CODEX_USAGE_MOCK_ERROR}`);
    err.code = process.env.CODEX_USAGE_MOCK_ERROR;
    throw err;
  }

  if (process.env.CODEX_USAGE_MOCK_PAYLOAD) {
    const payload = JSON.parse(fs.readFileSync(process.env.CODEX_USAGE_MOCK_PAYLOAD, "utf8"));
    if (!hasRecognizedWindows(payload?.rate_limit)) {
      const err = new Error("Mock Codex usage response changed shape.");
      err.code = "ENDPOINT";
      throw err;
    }
    return payload;
  }

  const auth = readCodexAuth(settings.authPath);
  const tokens = auth.tokens || {};
  const accessToken = tokens.access_token;
  const accountId = tokens.account_id;

  if (!accessToken || !accountId) {
    const err = new Error("Codex is not logged in.");
    err.code = "LOGIN";
    throw err;
  }

  let response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-Id": accountId,
        "User-Agent": "codex-cli",
        Accept: "application/json",
      },
    });
  } catch {
    const err = new Error("Network error while checking Codex usage.");
    err.code = "NETWORK";
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error("Codex login needs refresh.");
    err.code = "AUTH";
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`Usage request failed: ${response.status}`);
    err.code = response.status === 404 ? "ENDPOINT" : "HTTP";
    err.status = response.status;
    throw err;
  }

  const payload = await response.json();
  if (!hasRecognizedWindows(payload?.rate_limit)) {
    const err = new Error("Codex usage response changed shape.");
    err.code = "ENDPOINT";
    throw err;
  }
  return payload;
}

function readCodexAuth(authPathOverride) {
  const authPath = authPathOverride || path.join(os.homedir(), ".codex", "auth.json");
  if (!fs.existsSync(authPath)) {
    const err = new Error("Codex auth file not found.");
    err.code = "LOGIN";
    throw err;
  }

  try {
    return JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch {
    const err = new Error("Codex auth file could not be read.");
    err.code = "AUTH";
    throw err;
  }
}

async function renderAction(action, payload) {
  const snapshot = makeSnapshot(payload, action.settings);
  const svg = renderUsageSvg(snapshot, action.settings, { flickerOn: action.flickerOn });
  await action.sdkAction.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`, { target: 0 });
  await action.sdkAction.setTitle("");
}

async function renderError(action, error) {
  const svg = renderErrorSvg(error);
  await action.sdkAction.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`, { target: 0 });
  await action.sdkAction.setTitle("");
}

function makeSnapshot(payload, settings) {
  const windows = classifyRateLimitWindows(payload.rate_limit);
  const primary = windows.fiveHour || makeOpenWindow("5H");
  const weekly = windows.weekly || makeOpenWindow("WK");
  const lowest = lowestAvailableWindow([primary, weekly]);
  const level = getLevel(lowest.remainingPercent, settings);
  const rawSpark = (payload.additional_rate_limits || []).find((limit) => limit.limit_name || limit.metered_feature);
  const sparkWindows = rawSpark ? classifyRateLimitWindows(rawSpark.rate_limit, "SP") : null;
  const sparkAvailable = sparkWindows ? [sparkWindows.fiveHour, sparkWindows.weekly].filter(Boolean) : [];
  const spark = rawSpark && sparkAvailable.length > 0 ? {
    name: rawSpark.limit_name || rawSpark.metered_feature || "Extra",
    fiveHour: sparkWindows.fiveHour,
    weekly: sparkWindows.weekly,
    lowest: lowestAvailableWindow(sparkAvailable),
  } : null;

  return {
    planType: payload.plan_type || "codex",
    primary,
    weekly,
    lowest,
    level,
    spark,
    credits: payload.credits || null,
    allowed: payload.rate_limit?.allowed !== false,
    limitReached: payload.rate_limit?.limit_reached === true,
  };
}

function hasRecognizedWindows(rateLimit) {
  const windows = classifyRateLimitWindows(rateLimit);
  return Boolean(windows.fiveHour || windows.weekly);
}

function classifyRateLimitWindows(rateLimit, label = null) {
  const result = { fiveHour: null, weekly: null };
  for (const raw of [rateLimit?.primary_window, rateLimit?.secondary_window]) {
    const seconds = Number(raw?.limit_window_seconds || 0);
    if (seconds > 0 && seconds <= FIVE_HOUR_MAX_SECONDS && !result.fiveHour) {
      result.fiveHour = makeWindow(label || "5H", raw, rateLimit);
    } else if (seconds >= WEEKLY_MIN_SECONDS && !result.weekly) {
      result.weekly = makeWindow(label || "WK", raw, rateLimit);
    }
  }
  return result;
}

function lowestAvailableWindow(windows) {
  return windows.filter((window) => window?.available).reduce((lowest, window) => (
    !lowest || window.remainingPercent < lowest.remainingPercent ? window : lowest
  ), null);
}

function makeWindow(label, raw, root = {}) {
  const usedPercent = clampNumber(raw?.used_percent, 0, 0, 100);
  const remainingPercent = 100 - usedPercent;
  const resetAt = Number(raw?.reset_at || 0);
  return {
    label,
    available: true,
    usedPercent,
    remainingPercent,
    windowSeconds: Number(raw?.limit_window_seconds || 0),
    resetAfterSeconds: Number(raw?.reset_after_seconds || 0),
    resetAt,
    resetText: formatReset(raw?.reset_after_seconds),
    allowed: root.allowed !== false,
    limitReached: root.limit_reached === true,
  };
}

function makeOpenWindow(label) {
  return {
    label,
    available: false,
    usedPercent: null,
    remainingPercent: null,
    windowSeconds: 0,
    resetAfterSeconds: 0,
    resetAt: 0,
    resetText: "",
    allowed: true,
    limitReached: false,
  };
}

function getLevel(remaining, settings) {
  if (remaining <= settings.redThreshold) {
    return remaining <= settings.criticalThreshold ? "critical" : "red";
  }
  if (remaining <= settings.yellowThreshold) {
    return "yellow";
  }
  return "green";
}

function renderUsageSvg(snapshot, settings, state = {}) {
  switch (settings.displayMode) {
    case "ring":
      return renderRing(snapshot, settings, state);
    case "warning-tile":
      return renderWarningTile(snapshot, settings, state);
    case "split":
      return renderSplit(snapshot, settings, state);
    case "dual-bars":
    default:
      return renderDualBars(snapshot, settings, state);
  }
}

function palette(level) {
  if (level === "critical") {
    return {
      bg: "#15121d",
      panel: "#1d1421",
      accent: "#ff335d",
      soft: "#ffb1c0",
      text: "#fff8fb",
      muted: "#a99aa9",
      track: "#34303f",
      flash: "#3b1630",
    };
  }
  if (level === "red") {
    return {
      bg: "#15121d",
      panel: "#1b1624",
      accent: "#ffb020",
      soft: "#ffd28a",
      text: "#fffaf1",
      muted: "#aea0a4",
      track: "#34303f",
      flash: "#3a2416",
    };
  }
  if (level === "yellow") {
    return {
      bg: "#14151c",
      panel: "#181b25",
      accent: "#f6d84d",
      soft: "#fff2a6",
      text: "#fffbe5",
      muted: "#a9a692",
      track: "#333640",
      flash: "#3c3518",
    };
  }
  return {
    bg: "#071312",
    panel: "#111a25",
    accent: "#34e977",
    soft: "#9dffbe",
    text: "#f6fff8",
    muted: "#9ba9a9",
    track: "#263241",
    flash: "#16352d",
  };
}

function base(p, state = {}) {
  const panelFill = state.flickerOn ? p.flash : p.panel;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#000" flood-opacity=".36"/>
    </filter>
  </defs>
  <rect width="144" height="144" rx="28" fill="${p.bg}"/>
  <rect x="10" y="10" width="124" height="124" rx="23" fill="${panelFill}" filter="url(#shadow)"/>`;
}

function end() {
  return "</svg>";
}

function renderDualBars(snapshot, settings, state = {}) {
  const p = palette(snapshot.level);
  const primaryPalette = palette(levelForWindow(snapshot.primary, settings));
  const weeklyPalette = palette(levelForWindow(snapshot.weekly, settings));
  const primary = displayValue(snapshot.primary, settings);
  const weekly = displayValue(snapshot.weekly, settings);
  const primaryWidth = Math.max(4, barValue(snapshot.primary, settings) * 0.83);
  const weeklyWidth = Math.max(4, barValue(snapshot.weekly, settings) * 0.83);
  const percentFont = [primary, weekly].some((value) => value === "OPEN" || Number(value) >= 100) ? 23 : 26;
  return `${base(p, state)}
  <text x="20" y="45" fill="${p.text}" font-size="${percentFont}" font-family="Arial, sans-serif" font-weight="800">${primary}${snapshot.primary.available ? "%" : ""}</text>
  <text x="116" y="33" fill="${primaryPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">5H</text>
  <text x="116" y="53" fill="${p.text}" font-size="14" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${settings.showReset ? esc(snapshot.primary.resetText) : " "}</text>
  <line x1="24" y1="65" x2="107" y2="65" stroke="${p.track}" stroke-width="6" stroke-linecap="round"/>
  <line x1="24" y1="65" x2="${24 + primaryWidth}" y2="65" stroke="${primaryPalette.accent}" stroke-width="6" stroke-linecap="round"/>
  <text x="20" y="103" fill="${p.text}" font-size="${percentFont}" font-family="Arial, sans-serif" font-weight="800">${weekly}${snapshot.weekly.available ? "%" : ""}</text>
  <text x="116" y="91" fill="${weeklyPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">WK</text>
  <text x="116" y="111" fill="${p.text}" font-size="14" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${settings.showReset ? esc(snapshot.weekly.resetText) : " "}</text>
  <line x1="24" y1="123" x2="107" y2="123" stroke="${p.track}" stroke-width="6" stroke-linecap="round"/>
  <line x1="24" y1="123" x2="${24 + weeklyWidth}" y2="123" stroke="${weeklyPalette.accent}" stroke-width="6" stroke-linecap="round"/>
${end()}`;
}

function renderRing(snapshot, settings, state = {}) {
  const active = selectSingleWindow(snapshot, settings, "lowest");
  const level = levelForWindow(active, settings);
  const p = palette(level);
  const value = displayValue(active, settings);
  const arc = ringArc(72, 68, 43, Math.max(0.01, barValue(active, settings) / 100));
  return `${base(p, state)}
  <circle cx="72" cy="68" r="43" fill="none" stroke="${p.track}" stroke-width="10" stroke-linecap="round"/>
  <path d="${arc}" fill="none" stroke="${p.accent}" stroke-width="10" stroke-linecap="round"/>
  <text x="72" y="67" fill="${p.text}" font-size="${active.available ? 28 : 24}" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${value}${active.available ? "%" : ""}</text>
  <text x="72" y="85" fill="${p.text}" font-size="14" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${active.label}</text>
  <text x="72" y="113" fill="${p.text}" font-size="15" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${settings.showReset ? esc(active.resetText) : ""}</text>
${end()}`;
}

function renderWarningTile(snapshot, settings, state = {}) {
  const active = selectSingleWindow(snapshot, settings, "lowest");
  const level = levelForWindow(active, settings);
  const p = palette(level);
  const value = displayValue(active, settings);
  const label = active.label;
  return `${base(p, state)}
  <text x="72" y="40" fill="${p.accent}" font-size="18" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(label)}</text>
  <text x="72" y="87" fill="${p.text}" font-size="${active.available ? 47 : 36}" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${value}${active.available ? "%" : ""}</text>
  <line x1="38" y1="104" x2="106" y2="104" stroke="${p.track}" stroke-width="9" stroke-linecap="round"/>
  <line x1="38" y1="104" x2="${38 + Math.max(5, barValue(active, settings) * 0.68)}" y2="104" stroke="${p.accent}" stroke-width="9" stroke-linecap="round"/>
  <text x="72" y="127" fill="${p.text}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${settings.showReset ? esc(active.resetText) : active.label}</text>
${end()}`;
}

function renderSplit(snapshot, settings, state = {}) {
  const p = palette(snapshot.level);
  const primaryPalette = palette(levelForWindow(snapshot.primary, settings));
  const weeklyPalette = palette(levelForWindow(snapshot.weekly, settings));
  const p1 = displayValue(snapshot.primary, settings);
  const w1 = displayValue(snapshot.weekly, settings);
  const panelFill = state.flickerOn ? p.flash : p.panel;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="${p.bg}"/>
  <rect x="10" y="10" width="124" height="59" rx="21" fill="${panelFill}"/>
  <rect x="10" y="75" width="124" height="59" rx="21" fill="${panelFill}"/>
  <text x="24" y="35" fill="${primaryPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900">5H</text>
  <text x="24" y="59" fill="${p.text}" font-size="${snapshot.primary.available ? 28 : 22}" font-family="Arial, sans-serif" font-weight="900">${p1}${snapshot.primary.available ? "%" : ""}</text>
  <text x="122" y="56" fill="#ffffff" font-size="18" font-family="Arial, sans-serif" font-weight="900" text-anchor="end">${settings.showReset ? esc(snapshot.primary.resetText) : ""}</text>
  <text x="24" y="100" fill="${weeklyPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900">WK</text>
  <text x="24" y="124" fill="${p.text}" font-size="${snapshot.weekly.available ? 28 : 22}" font-family="Arial, sans-serif" font-weight="900">${w1}${snapshot.weekly.available ? "%" : ""}</text>
  <text x="122" y="121" fill="#ffffff" font-size="18" font-family="Arial, sans-serif" font-weight="900" text-anchor="end">${settings.showReset ? esc(snapshot.weekly.resetText) : ""}</text>
${end()}`;
}

function renderErrorSvg(error) {
  const state = errorState(error);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="${state.bg}"/>
  <rect x="10" y="10" width="124" height="124" rx="23" fill="${state.panel}"/>
  <circle cx="72" cy="49" r="22" fill="none" stroke="${state.accent}" stroke-width="8"/>
  ${state.icon}
  <text x="72" y="94" fill="#fff8ef" font-size="${state.size}" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${state.label}</text>
  <text x="72" y="115" fill="#fff8ef" font-size="17" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${state.sub}</text>
  <text x="72" y="130" fill="#b8abb6" font-size="9" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">v${PLUGIN_VERSION}</text>
</svg>`;
}

function errorState(error) {
  if (error.code === "LOGIN") {
    return {
      bg: "#101722",
      panel: "#151d2b",
      accent: "#34e977",
      label: "LOGIN",
      sub: "CODEX",
      size: "24",
      icon: `<path d="M62 49h20M72 39v20" stroke="#34e977" stroke-width="7" stroke-linecap="round"/>`,
    };
  }
  if (error.code === "AUTH") {
    return {
      bg: "#171019",
      panel: "#211522",
      accent: "#ffb020",
      label: "AUTH",
      sub: "EXPIRED",
      size: "24",
      icon: `<path d="M72 31v24" stroke="#ffb020" stroke-width="8" stroke-linecap="round"/><circle cx="72" cy="66" r="4" fill="#ffb020"/>`,
    };
  }
  if (error.code === "NETWORK") {
    return {
      bg: "#10141c",
      panel: "#171d28",
      accent: "#60a5fa",
      label: "NETWORK",
      sub: "RETRY",
      size: "19",
      icon: `<path d="M58 50q14-15 28 0M64 58q8-8 16 0" fill="none" stroke="#60a5fa" stroke-width="6" stroke-linecap="round"/>`,
    };
  }
  if (error.code === "ENDPOINT") {
    return {
      bg: "#181015",
      panel: "#221820",
      accent: "#ff5f7c",
      label: "API",
      sub: "CHANGED",
      size: "26",
      icon: `<path d="M72 31v24" stroke="#ff5f7c" stroke-width="8" stroke-linecap="round"/><circle cx="72" cy="66" r="4" fill="#ff5f7c"/>`,
    };
  }
  return {
    bg: "#120f18",
    panel: "#1b1422",
    accent: "#ffb020",
    label: "RETRY",
    sub: "USAGE",
    size: "24",
    icon: `<path d="M72 31v24" stroke="#ffb020" stroke-width="8" stroke-linecap="round"/><circle cx="72" cy="66" r="4" fill="#ffb020"/>`,
  };
}

function selectSingleWindow(snapshot, settings, fallback) {
  if (settings.singleWindow === "primary") {
    return snapshot.primary;
  }
  if (settings.singleWindow === "weekly") {
    return snapshot.weekly;
  }
  if (settings.singleWindow === "spark" && snapshot.spark?.lowest) {
    return snapshot.spark.lowest;
  }
  return fallback === "weekly" ? snapshot.weekly : snapshot.lowest;
}

function activeDisplayLevel(snapshot, settings) {
  if (settings.displayMode === "ring" || settings.displayMode === "warning-tile") {
    return levelForWindow(selectSingleWindow(snapshot, settings, "lowest"), settings);
  }
  return snapshot.level;
}

function flickerConfig(settings, level) {
  return {
    yellow: { enabled: settings.yellowFlicker, seconds: settings.yellowFlickerSeconds },
    red: { enabled: settings.redFlicker, seconds: settings.redFlickerSeconds },
    critical: { enabled: settings.criticalFlicker, seconds: settings.criticalFlickerSeconds },
  }[level];
}

function valueFor(window, settings) {
  return settings.basis === "used" ? window.usedPercent : window.remainingPercent;
}

function displayValue(window, settings) {
  return window.available ? valueFor(window, settings) : "OPEN";
}

function barValue(window, settings) {
  return window.available ? valueFor(window, settings) : 100;
}

function levelForWindow(window, settings) {
  return window.available ? getLevel(window.remainingPercent, settings) : "green";
}

function formatReset(seconds) {
  const value = Number(seconds || 0);
  if (value <= 0) {
    return "now";
  }
  const minutes = Math.ceil(value / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function ringArc(cx, cy, r, fraction) {
  const start = -140;
  const end = start + 280 * fraction;
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const large = end - start <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function polar(cx, cy, r, degrees) {
  const rad = (degrees - 90) * Math.PI / 180;
  return {
    x: Number((cx + r * Math.cos(rad)).toFixed(2)),
    y: Number((cy + r * Math.sin(rad)).toFixed(2)),
  };
}

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
