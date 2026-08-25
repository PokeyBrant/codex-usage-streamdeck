#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import streamDeck, { SingletonAction } from "@elgato/streamdeck";

const PLUGIN_UUID = "com.statuscheck.codex-usage";
const ACTION_UUID = "com.statuscheck.codex-usage.usage";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const PLUGIN_VERSION = "0.1.12.0";
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
      lastResetDetails: null,
      resetDetailsError: null,
      lastError: null,
      lastUpdatedAt: null,
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
    const existing = actions.get(context);
    const action = existing || {
      context,
      sdkAction: ev.action,
      refreshTimer: null,
      flickerTimer: null,
      flickerOn: false,
      lastUsage: null,
      lastResetDetails: null,
      resetDetailsError: null,
      lastError: null,
      lastUpdatedAt: null,
    };
    const authPathChanged = action.settings?.authPath !== settings.authPath;
    const refreshChanged = action.settings?.refreshSeconds !== settings.refreshSeconds;
    action.sdkAction = ev.action;
    action.settings = settings;
    actions.set(context, action);
    if (!existing || refreshChanged) {
      scheduleRefresh(context);
    }
    if (!existing || authPathChanged || (!action.lastUsage && !action.lastError)) {
      await refreshAction(context, { force: true });
      return;
    }
    if (action.lastUsage) {
      action.flickerOn = false;
      await renderAction(action, action.lastUsage);
      scheduleFlicker(context);
    } else if (action.lastError) {
      await renderError(action, action.lastError);
    }
    await sendUsageStatus(action);
  }

  async onSendToPlugin(ev) {
    if (ev.payload?.type === "refresh") {
      await refreshAction(ev.action.id, { force: true, feedback: true });
    } else if (ev.payload?.type === "request-status") {
      const action = actions.get(ev.action.id);
      if (action) {
        await sendUsageStatus(action);
      }
    }
  }

  async onPropertyInspectorDidAppear(ev) {
    const action = actions.get(ev.action.id);
    if (action) {
      await sendUsageStatus(action);
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
  const snapshot = makeSnapshot(action.lastUsage, action.settings, action.lastResetDetails);
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

  await sendUsageStatus(action, "refreshing");
  try {
    const [usageResult, resetDetailsResult] = await Promise.allSettled([
      fetchCodexUsage(action.settings),
      fetchResetDetails(action.settings),
    ]);
    if (usageResult.status === "rejected") {
      throw usageResult.reason;
    }
    const usage = usageResult.value;
    action.lastUsage = usage;
    action.lastResetDetails = resetDetailsResult.status === "fulfilled" ? resetDetailsResult.value : null;
    action.resetDetailsError = resetDetailsResult.status === "rejected" ? resetDetailsResult.reason : null;
    action.lastError = null;
    action.lastUpdatedAt = new Date().toISOString();
    action.flickerOn = false;
    await renderAction(action, usage);
    scheduleFlicker(context);
    await sendUsageStatus(action, "ok");
    if (options.feedback) {
      await action.sdkAction.showOk();
    }
  } catch (error) {
    action.lastError = error;
    action.lastUsage = null;
    stopFlicker(action);
    await renderError(action, error);
    await sendUsageStatus(action, "error", error);
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
    showManualResets: true,
    use24HourTime: false,
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
    showManualResets: toBool(raw.showManualResets, defaults.showManualResets),
    use24HourTime: toBool(raw.use24HourTime, defaults.use24HourTime),
    authPath: typeof raw.authPath === "string" ? raw.authPath.trim() : defaults.authPath,
    basis: pick(raw.basis, defaults.basis),
    singleWindow: normalizeSingleWindow(raw.singleWindow, legacyDisplayMode, defaults.singleWindow, raw.showSpark),
  };
}

function pick(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeDisplayMode(value) {
  if (value === "dual-bars" || value === "ring" || value === "warning-tile" || value === "split" || value === "reset-details") {
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

async function fetchResetDetails(settings) {
  if (process.env.CODEX_RESET_CREDITS_MOCK_ERROR) {
    const err = new Error(`Mock ${process.env.CODEX_RESET_CREDITS_MOCK_ERROR}`);
    err.code = process.env.CODEX_RESET_CREDITS_MOCK_ERROR;
    throw err;
  }

  if (process.env.CODEX_RESET_CREDITS_MOCK_PAYLOAD) {
    return JSON.parse(fs.readFileSync(process.env.CODEX_RESET_CREDITS_MOCK_PAYLOAD, "utf8"));
  }

  // Usage fixtures should remain fully offline unless a reset-details fixture is supplied.
  if (process.env.CODEX_USAGE_MOCK_PAYLOAD || process.env.CODEX_USAGE_MOCK_ERROR) {
    return null;
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
    response = await fetch(RESET_CREDITS_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-Id": accountId,
        "User-Agent": "codex-cli",
        Accept: "application/json",
      },
    });
  } catch {
    const err = new Error("Network error while checking reset details.");
    err.code = "NETWORK";
    throw err;
  }

  if (response.status === 401 || response.status === 403) {
    const err = new Error("Codex login needs refresh.");
    err.code = "AUTH";
    throw err;
  }

  if (!response.ok) {
    const err = new Error(`Reset details request failed: ${response.status}`);
    err.code = response.status === 404 ? "ENDPOINT" : "HTTP";
    err.status = response.status;
    throw err;
  }

  return response.json();
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
  const snapshot = makeSnapshot(payload, action.settings, action.lastResetDetails);
  const svg = renderUsageSvg(snapshot, action.settings, { flickerOn: action.flickerOn });
  await action.sdkAction.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`, { target: 0 });
  await action.sdkAction.setTitle("");
}

async function renderError(action, error) {
  const svg = renderErrorSvg(error);
  await action.sdkAction.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`, { target: 0 });
  await action.sdkAction.setTitle("");
}

async function sendUsageStatus(action, state = null, error = null) {
  if (!action) {
    return;
  }
  const snapshot = action.lastUsage ? makeSnapshot(action.lastUsage, action.settings, action.lastResetDetails) : null;
  const resolvedState = state || (action.lastError ? "error" : action.lastUsage ? "ok" : "refreshing");
  const statusError = error || action.lastError;
  const knownErrorCodes = new Set(["LOGIN", "AUTH", "NETWORK", "ENDPOINT", "HTTP"]);
  const errorCode = resolvedState === "error" && knownErrorCodes.has(statusError?.code) ? statusError.code : null;
  try {
    await streamDeck.ui.sendToPropertyInspector({
      type: "usage-status",
      state: resolvedState,
      lastUpdatedAt: action.lastUpdatedAt,
      resetCredits: {
        availableCount: snapshot?.resetCredits.availableCount ?? null,
        applicableAvailableCount: snapshot?.resetCredits.applicableAvailableCount ?? null,
        applicableReported: snapshot?.resetCredits.applicableReported ?? false,
        detailsReported: snapshot?.resetCredits.details.detailsReported ?? false,
        title: snapshot?.resetCredits.details.title ?? null,
        resetType: snapshot?.resetCredits.details.resetType ?? null,
        status: snapshot?.resetCredits.details.status ?? null,
        expiresAt: snapshot?.resetCredits.details.expiresAt ?? null,
        detailsError: action.resetDetailsError ? sanitizeErrorCode(action.resetDetailsError) : null,
      },
      capabilities: {
        sparkAvailable: Boolean(snapshot?.spark),
      },
      errorCode,
    });
  } catch {
    // The property inspector may not be visible; key rendering should continue normally.
  }
}

function makeSnapshot(payload, settings, resetDetailsPayload = null) {
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
  const usageResetCredits = normalizeResetCredits(payload.rate_limit_reset_credits);
  const resetDetails = normalizeResetDetails(resetDetailsPayload);
  const bankedCount = resetDetails.availableCount ?? usageResetCredits.availableCount;
  const resetCredits = {
    ...usageResetCredits,
    availableCount: bankedCount,
    keyDisplayCount: bankedCount,
    details: resetDetails,
  };

  return {
    planType: payload.plan_type || "codex",
    primary,
    weekly,
    lowest,
    level,
    spark,
    resetCredits,
    credits: payload.credits || null,
    allowed: payload.rate_limit?.allowed !== false,
    limitReached: payload.rate_limit?.limit_reached === true,
  };
}

function normalizeResetCredits(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      availableCount: null,
      applicableAvailableCount: null,
      applicableReported: false,
      keyDisplayCount: null,
    };
  }
  const applicableReported = Object.prototype.hasOwnProperty.call(raw, "applicable_available_count");
  const availableCount = normalizeNonNegativeInteger(raw.available_count);
  const applicableAvailableCount = applicableReported
    ? normalizeNonNegativeInteger(raw.applicable_available_count)
    : null;
  return {
    availableCount,
    applicableAvailableCount,
    applicableReported,
    keyDisplayCount: availableCount,
  };
}

function normalizeResetDetails(raw) {
  const empty = {
    detailsReported: false,
    availableCount: null,
    title: null,
    resetType: null,
    status: null,
    expiresAt: null,
  };
  if (!raw || typeof raw !== "object") {
    return empty;
  }

  const availableCount = normalizeNonNegativeInteger(raw.available_count);
  const credits = Array.isArray(raw.credits) ? raw.credits : [];
  const availableCredits = credits.filter((credit) => (
    credit
    && typeof credit === "object"
    && credit.status === "available"
    && credit.is_supported_by_plan !== false
  ));
  const selected = availableCredits
    .map((credit) => ({ credit, expiresAt: normalizeIsoTimestamp(credit.expires_at) }))
    .sort((left, right) => {
      if (left.expiresAt == null) return 1;
      if (right.expiresAt == null) return -1;
      return Date.parse(left.expiresAt) - Date.parse(right.expiresAt);
    })[0];

  return {
    detailsReported: true,
    availableCount,
    title: normalizeDisplayText(selected?.credit.title, 32),
    resetType: normalizeDisplayText(selected?.credit.reset_type, 40),
    status: normalizeDisplayText(selected?.credit.status, 24),
    expiresAt: selected?.expiresAt ?? null,
  };
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeDisplayText(value, maxLength) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function sanitizeErrorCode(error) {
  const knownErrorCodes = new Set(["LOGIN", "AUTH", "NETWORK", "ENDPOINT", "HTTP"]);
  return knownErrorCodes.has(error?.code) ? error.code : "HTTP";
}

function normalizeNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
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
    case "reset-details":
      return renderResetDetails(snapshot, settings, state);
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
  const primarySecondary = keySecondaryText(snapshot.primary, snapshot, settings, snapshot.primary === snapshot.lowest);
  const weeklySecondary = keySecondaryText(snapshot.weekly, snapshot, settings, snapshot.weekly === snapshot.lowest);
  const primarySecondaryX = manualResetVisible(snapshot, settings, snapshot.primary === snapshot.lowest) ? 109 : 116;
  const weeklySecondaryX = manualResetVisible(snapshot, settings, snapshot.weekly === snapshot.lowest) ? 109 : 116;
  return `${base(p, state)}
  <text x="20" y="45" fill="${p.text}" font-size="${percentFont}" font-family="Arial, sans-serif" font-weight="800">${primary}${snapshot.primary.available ? "%" : ""}</text>
  <text x="116" y="33" fill="${primaryPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">5H</text>
  <text x="${primarySecondaryX}" y="53" fill="${p.text}" font-size="${secondaryFontSize(primarySecondary, 14)}" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${esc(primarySecondary || " ")}</text>
  <line x1="24" y1="65" x2="107" y2="65" stroke="${p.track}" stroke-width="6" stroke-linecap="round"/>
  <line x1="24" y1="65" x2="${24 + primaryWidth}" y2="65" stroke="${primaryPalette.accent}" stroke-width="6" stroke-linecap="round"/>
  <text x="20" y="103" fill="${p.text}" font-size="${percentFont}" font-family="Arial, sans-serif" font-weight="800">${weekly}${snapshot.weekly.available ? "%" : ""}</text>
  <text x="116" y="91" fill="${weeklyPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">WK</text>
  <text x="${weeklySecondaryX}" y="111" fill="${p.text}" font-size="${secondaryFontSize(weeklySecondary, 14)}" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${esc(weeklySecondary || " ")}</text>
  <line x1="24" y1="123" x2="107" y2="123" stroke="${p.track}" stroke-width="6" stroke-linecap="round"/>
  <line x1="24" y1="123" x2="${24 + weeklyWidth}" y2="123" stroke="${weeklyPalette.accent}" stroke-width="6" stroke-linecap="round"/>
${end()}`;
}

function renderRing(snapshot, settings, state = {}) {
  const active = selectSingleWindow(snapshot, settings, "lowest");
  const level = levelForWindow(active, settings);
  const p = palette(level);
  const value = displayValue(active, settings);
  const ringStart = -125;
  const ringSweep = 250;
  const arc = ringArc(72, 72, 46, Math.max(0.01, barValue(active, settings) / 100), ringStart, ringSweep);
  const track = `<path d="${ringArc(72, 72, 46, 1, ringStart, ringSweep)}" fill="none" stroke="${p.track}" stroke-width="10" stroke-linecap="round"/>`;
  const secondary = keySecondaryText(active, snapshot, settings, active.label !== "SP");
  return `${base(p, state)}
  ${track}
  <path d="${arc}" fill="none" stroke="${p.accent}" stroke-width="10" stroke-linecap="round"/>
  <text x="72" y="71" fill="${p.text}" font-size="${active.available ? 27 : 24}" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${value}${active.available ? "%" : ""}</text>
  <text x="72" y="89" fill="${p.text}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${active.label}</text>
  <text x="72" y="117" fill="${p.text}" font-size="${secondaryFontSize(secondary, 17)}" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${esc(secondary)}</text>
${end()}`;
}

function renderWarningTile(snapshot, settings, state = {}) {
  const active = selectSingleWindow(snapshot, settings, "lowest");
  const level = levelForWindow(active, settings);
  const p = palette(level);
  const value = displayValue(active, settings);
  const label = warningWindowLabel(active.label);
  const resetDuration = settings.showReset && active.available
    ? formatResetVerbose(active.resetAfterSeconds)
    : "";
  const resetIndicator = manualResetVisible(snapshot, settings, active.label !== "SP")
    ? `R${snapshot.resetCredits.keyDisplayCount}`
    : "";
  const resetLine = [resetDuration, resetIndicator].filter(Boolean).join(" · ");
  const resetClock = settings.showReset && active.available
    ? formatResetClock(active.resetAt, settings.use24HourTime)
    : "";
  return `${base(p, state)}
  <text x="72" y="32" fill="${p.accent}" font-size="20" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(label)}</text>
  <text x="72" y="75" fill="${p.text}" font-size="${active.available ? 47 : 36}" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${value}${active.available ? "%" : ""}</text>
  <line x1="30" y1="91" x2="113" y2="91" stroke="${p.track}" stroke-width="9" stroke-linecap="round"/>
  <line x1="30" y1="91" x2="${30 + Math.max(5, barValue(active, settings) * 0.83)}" y2="91" stroke="${p.accent}" stroke-width="9" stroke-linecap="round"/>
  <text x="72" y="113" fill="${p.text}" font-size="${warningDetailFontSize(resetLine)}" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(resetLine)}</text>
  <text x="72" y="130" fill="${p.text}" font-size="13" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${esc(resetClock)}</text>
${end()}`;
}

function renderSplit(snapshot, settings, state = {}) {
  const p = palette(snapshot.level);
  const primaryPalette = palette(levelForWindow(snapshot.primary, settings));
  const weeklyPalette = palette(levelForWindow(snapshot.weekly, settings));
  const p1 = displayValue(snapshot.primary, settings);
  const w1 = displayValue(snapshot.weekly, settings);
  const panelFill = state.flickerOn ? p.flash : p.panel;
  const primarySecondary = keySecondaryText(snapshot.primary, snapshot, settings, snapshot.primary === snapshot.lowest);
  const weeklySecondary = keySecondaryText(snapshot.weekly, snapshot, settings, snapshot.weekly === snapshot.lowest);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="${p.bg}"/>
  <rect x="10" y="10" width="124" height="59" rx="21" fill="${panelFill}"/>
  <rect x="10" y="75" width="124" height="59" rx="21" fill="${panelFill}"/>
  <text x="24" y="35" fill="${primaryPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900">5H</text>
  <text x="24" y="59" fill="${p.text}" font-size="${snapshot.primary.available ? 28 : 22}" font-family="Arial, sans-serif" font-weight="900">${p1}${snapshot.primary.available ? "%" : ""}</text>
  <text x="122" y="35" fill="#ffffff" font-size="${secondaryFontSize(primarySecondary, 18)}" font-family="Arial, sans-serif" font-weight="900" text-anchor="end">${esc(primarySecondary)}</text>
  <text x="24" y="100" fill="${weeklyPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900">WK</text>
  <text x="24" y="124" fill="${p.text}" font-size="${snapshot.weekly.available ? 28 : 22}" font-family="Arial, sans-serif" font-weight="900">${w1}${snapshot.weekly.available ? "%" : ""}</text>
  <text x="122" y="100" fill="#ffffff" font-size="${secondaryFontSize(weeklySecondary, 18)}" font-family="Arial, sans-serif" font-weight="900" text-anchor="end">${esc(weeklySecondary)}</text>
${end()}`;
}

function renderResetDetails(snapshot, settings, state = {}) {
  const count = snapshot.resetCredits.availableCount;
  const hasReset = Number.isInteger(count) && count > 0;
  const countLabel = hasReset ? `R${count}` : count === 0 ? "NONE" : "—";
  const details = snapshot.resetCredits.details;
  const expiresDate = formatExpirationDate(details.expiresAt);
  const expirationLabel = hasReset
    ? expiresDate ? expiresDate.toUpperCase() : details.detailsReported ? "EXPIRY NOT REPORTED" : "DETAILS UNAVAILABLE"
    : count === 0 ? "NO RESET AVAILABLE" : "DETAILS UNAVAILABLE";
  const p = hasReset ? palette("green") : {
    ...palette("green"),
    accent: "#8f9baa",
    soft: "#c7d0db",
  };
  const expirationBlock = hasReset && expiresDate
    ? `<text x="72" y="96" fill="${p.accent}" font-size="11" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">EXPIRES</text>
  <text x="72" y="123" fill="${p.accent}" font-size="24" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(expirationLabel)}</text>`
    : `<text x="72" y="117" fill="${p.soft}" font-size="${resetExpirationFontSize(expirationLabel)}" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(expirationLabel)}</text>`;
  return `${base(p, state)}
  <text x="72" y="75" fill="${p.text}" font-size="${hasReset ? 58 : 34}" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(countLabel)}</text>
  ${expirationBlock}
${end()}`;
}

function resetExpirationFontSize(label) {
  return String(label || "").length > 16 ? 11 : 13;
}

function keySecondaryText(window, snapshot, settings, includeManualResets) {
  const parts = [];
  if (settings.showReset && window.available && window.resetText) {
    parts.push(window.resetText);
  }
  if (manualResetVisible(snapshot, settings, includeManualResets)) {
    parts.push(`R${snapshot.resetCredits.keyDisplayCount}`);
  }
  return parts.join(" · ");
}

function manualResetVisible(snapshot, settings, includeManualResets) {
  const resetCount = snapshot.resetCredits.keyDisplayCount;
  return Boolean(
    includeManualResets
    && settings.showManualResets
    && Number.isInteger(resetCount)
    && resetCount > 0
  );
}

function secondaryFontSize(text, baseSize) {
  return text.length > 5 ? Math.max(12, baseSize - 3) : baseSize;
}

function warningWindowLabel(label) {
  return {
    "5H": "5 Hours",
    WK: "Week",
    SP: "Spark",
  }[label] || label;
}

function warningDetailFontSize(text) {
  if (text.length > 12) {
    return 14;
  }
  if (text.length > 8) {
    return 15;
  }
  return 17;
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
  if (settings.displayMode === "reset-details") {
    return "green";
  }
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

function formatResetVerbose(seconds) {
  const value = Number(seconds || 0);
  if (value <= 0) {
    return "now";
  }
  const minutes = Math.ceil(value / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function formatResetClock(resetAt, use24HourTime = false) {
  const timestamp = Number(resetAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: use24HourTime ? "2-digit" : "numeric",
    minute: "2-digit",
    ...(use24HourTime ? { hourCycle: "h23" } : { hour12: true }),
  }).format(date);
}

function formatExpirationDate(expiresAt) {
  const date = new Date(expiresAt || "");
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function ringArc(cx, cy, r, fraction, start = -140, sweep = 280) {
  const end = start + sweep * fraction;
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
