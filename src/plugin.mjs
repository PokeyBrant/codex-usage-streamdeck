#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import streamDeck, { SingletonAction } from "@elgato/streamdeck";

const PLUGIN_UUID = "com.statuscheck.codex-usage";
const ACTION_UUID = "com.statuscheck.codex-usage.usage";
const USAGE_URL = "https://chatgpt.com/backend-api/codex/usage";
const REFRESH_URL = "https://auth.openai.com/oauth/token";
const REFRESH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const PLUGIN_VERSION = "0.1.15.0";
const LOG_PATH = path.join(process.cwd(), "logs", "codex-usage.log");

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
    logInfo("plugin_start", { version: PLUGIN_VERSION, cwd: process.cwd() });
    await streamDeck.connect();
  } catch (error) {
    clearInterval(runtimeKeepAlive);
    logError("connect_failed", error);
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
    logError("refresh_failed", error);
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
  logInfo("fetch_start", { version: PLUGIN_VERSION, mock: Boolean(process.env.CODEX_USAGE_MOCK_PAYLOAD || process.env.CODEX_USAGE_MOCK_ERROR) });
  if (process.env.CODEX_USAGE_MOCK_ERROR) {
    const err = new Error(`Mock ${process.env.CODEX_USAGE_MOCK_ERROR}`);
    err.code = process.env.CODEX_USAGE_MOCK_ERROR;
    throw err;
  }

  if (process.env.CODEX_USAGE_MOCK_PAYLOAD) {
    const payload = JSON.parse(fs.readFileSync(process.env.CODEX_USAGE_MOCK_PAYLOAD, "utf8"));
    if (!normalizeUsagePayload(payload)) {
      const err = new Error("Mock Codex usage response changed shape.");
      err.code = "ENDPOINT";
      throw err;
    }
    return normalizeUsagePayload(payload);
  }

  const authPath = resolveAuthPath(settings.authPath);
  let auth = readCodexAuth(authPath);
  let tokens = getAuthTokens(auth);
  logInfo("auth_loaded", {
    authPath: redactHome(authPath),
    hasAccessToken: Boolean(tokens.accessToken),
    hasRefreshToken: Boolean(tokens.refreshToken),
    hasAccountId: Boolean(tokens.accountId),
    idTokenExp: getIdTokenExp(auth),
  });

  if (!tokens.accessToken || !tokens.accountId) {
    const err = new Error("Codex is not logged in.");
    err.code = "LOGIN";
    throw err;
  }

  let response = await requestUsage(tokens);
  logInfo("usage_response", { status: response.status });

  if (response.status === 401 || response.status === 403) {
    logInfo("usage_auth_rejected", { status: response.status });
    auth = await refreshCodexAuth(authPath, auth);
    tokens = getAuthTokens(auth);
    if (!tokens.accessToken || !tokens.accountId) {
      const err = new Error("Codex login needs refresh.");
      err.code = "AUTH";
      throw err;
    }
    response = await requestUsage(tokens);
    logInfo("usage_response_after_refresh", { status: response.status });
    if (response.status === 401 || response.status === 403) {
      const err = new Error("Codex login needs refresh.");
      err.code = "AUTH";
      throw err;
    }
  }

  if (!response.ok) {
    const err = new Error(`Usage request failed: ${response.status}`);
    err.code = response.status === 404 ? "ENDPOINT" : "HTTP";
    err.status = response.status;
    throw err;
  }

  const payload = await response.json();
  const normalizedPayload = normalizeUsagePayload(payload);
  if (!normalizedPayload) {
    logInfo("payload_unrecognized", summarizePayload(payload));
    const err = new Error("Codex usage response changed shape.");
    err.code = "ENDPOINT";
    throw err;
  }
  logInfo("payload_ok", summarizePayload(payload));
  return normalizedPayload;
}

function resolveAuthPath(authPathOverride) {
  return authPathOverride || path.join(os.homedir(), ".codex", "auth.json");
}

async function requestUsage(tokens) {
  if (process.platform === "win32") {
    return requestUsageWithPowerShell(tokens);
  }

  try {
    return await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "ChatGPT-Account-Id": tokens.accountId,
        "User-Agent": "codex-cli",
        Accept: "application/json",
      },
    });
  } catch {
    const err = new Error("Network error while checking Codex usage.");
    err.code = "NETWORK";
    throw err;
  }
}

function requestUsageWithPowerShell(tokens) {
  return new Promise((resolve, reject) => {
    const script = `
$ErrorActionPreference = 'Stop'
$inputJson = [Console]::In.ReadToEnd()
$data = $inputJson | ConvertFrom-Json
$headers = @{
  Authorization = 'Bearer ' + $data.accessToken
  'ChatGPT-Account-Id' = $data.accountId
  'User-Agent' = 'codex-cli'
  Accept = 'application/json'
}
try {
  $r = Invoke-WebRequest -Uri '${USAGE_URL}' -Headers $headers -Method GET -UseBasicParsing
  [Console]::Out.Write((@{ status = [int]$r.StatusCode; body = $r.Content } | ConvertTo-Json -Compress))
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    [Console]::Out.Write((@{ status = [int]$resp.StatusCode; body = $reader.ReadToEnd() } | ConvertTo-Json -Compress))
  } else {
    throw
  }
}
`;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      const err = new Error("Network error while checking Codex usage.");
      err.code = "NETWORK";
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const err = new Error(stderr.trim() || "Network error while checking Codex usage.");
        err.code = "NETWORK";
        reject(err);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve({
          status: Number(result.status || 0),
          ok: Number(result.status || 0) >= 200 && Number(result.status || 0) < 300,
          json: async () => JSON.parse(result.body),
        });
      } catch {
        const err = new Error("Usage response could not be read.");
        err.code = "HTTP";
        reject(err);
      }
    });
    child.stdin.end(JSON.stringify({
      accessToken: tokens.accessToken,
      accountId: tokens.accountId,
    }));
  });
}

function readCodexAuth(authPath) {
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

function getAuthTokens(auth) {
  const tokens = auth.tokens || {};
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accountId: tokens.account_id || tokens.id_token?.chatgpt_account_id,
  };
}

async function refreshCodexAuth(authPath, auth) {
  const tokens = getAuthTokens(auth);
  if (!tokens.refreshToken) {
    const err = new Error("Codex refresh token is not available.");
    err.code = "AUTH";
    throw err;
  }

  let response;
  try {
    logInfo("token_refresh_start", { url: REFRESH_URL });
    response = await fetch(REFRESH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "codex-cli",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: REFRESH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }),
    });
  } catch {
    const err = new Error("Network error while refreshing Codex login.");
    err.code = "NETWORK";
    throw err;
  }

  logInfo("token_refresh_response", { status: response.status });
  if (!response.ok) {
    const err = new Error("Codex login needs refresh.");
    err.code = "AUTH";
    throw err;
  }

  const refreshed = await response.json();
  const nextAuth = {
    ...auth,
    tokens: {
      ...(auth.tokens || {}),
      access_token: refreshed.access_token || auth.tokens?.access_token,
      refresh_token: refreshed.refresh_token || auth.tokens?.refresh_token,
    },
    last_refresh: new Date().toISOString(),
  };

  if (refreshed.id_token) {
    nextAuth.tokens.id_token = parseJwtPayload(refreshed.id_token) || auth.tokens?.id_token;
  }

  fs.writeFileSync(authPath, `${JSON.stringify(nextAuth, null, 2)}\n`, "utf8");
  logInfo("token_refresh_saved", { authPath: redactHome(authPath), hasNewAccessToken: Boolean(refreshed.access_token) });
  return nextAuth;
}

function parseJwtPayload(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
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
  const primary = makeWindow("5H", payload.rate_limit?.primary_window, payload.rate_limit);
  const weekly = makeWindow("WK", payload.rate_limit?.secondary_window, payload.rate_limit);
  const lowest = primary.remainingPercent <= weekly.remainingPercent ? primary : weekly;
  const level = getLevel(lowest.remainingPercent, settings);
  const rawSpark = (payload.additional_rate_limits || []).find((limit) => limit.limit_name || limit.metered_feature);
  const spark = rawSpark ? {
    name: rawSpark.limit_name || rawSpark.metered_feature || "Extra",
    primary: makeWindow("SP", rawSpark.rate_limit?.primary_window, rawSpark.rate_limit),
    weekly: makeWindow("SP", rawSpark.rate_limit?.secondary_window, rawSpark.rate_limit),
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

function normalizeUsagePayload(payload) {
  if (payload?.rate_limit?.primary_window) {
    return {
      ...payload,
      rate_limit: {
        ...payload.rate_limit,
        secondary_window: payload.rate_limit.secondary_window || payload.rate_limit.primary_window,
      },
      additional_rate_limits: payload.additional_rate_limits || [],
    };
  }

  const primary = payload?.primary || payload?.primaryWindow || payload?.rateLimit?.primary;
  const secondary = payload?.secondary || payload?.secondaryWindow || payload?.rateLimit?.secondary || primary;
  if (!primary) {
    return null;
  }

  const additionalRateLimits = payload.additional_rate_limits || payload.additionalRateLimits || [];
  return {
    plan_type: payload.plan_type || payload.planType || "codex",
    rate_limit: {
      allowed: payload.allowed !== false && payload.rateLimit?.allowed !== false,
      limit_reached: payload.limit_reached === true || payload.limitReached === true || payload.rateLimit?.limitReached === true,
      primary_window: normalizeWindow(primary),
      secondary_window: normalizeWindow(secondary),
    },
    code_review_rate_limit: payload.code_review_rate_limit || payload.codeReviewRateLimit || null,
    additional_rate_limits: additionalRateLimits
      .map(normalizeAdditionalLimit)
      .filter(Boolean),
    credits: payload.credits || null,
  };
}

function normalizeAdditionalLimit(limit) {
  const primary = limit?.rate_limit?.primary_window || limit?.primary || limit?.primaryWindow || limit?.rateLimit?.primary;
  const secondary = limit?.rate_limit?.secondary_window || limit?.secondary || limit?.secondaryWindow || limit?.rateLimit?.secondary;
  if (!primary && !secondary) {
    return null;
  }

  return {
    limit_name: limit.limit_name || limit.limitName || limit.metered_feature || limit.meteredFeature || "Extra",
    metered_feature: limit.metered_feature || limit.meteredFeature || null,
    rate_limit: {
      allowed: limit.allowed !== false && limit.rateLimit?.allowed !== false,
      limit_reached: limit.limit_reached === true || limit.limitReached === true || limit.rateLimit?.limitReached === true,
      primary_window: normalizeWindow(primary || secondary),
      secondary_window: normalizeWindow(secondary || primary),
    },
  };
}

function normalizeWindow(window) {
  const usedPercent = window?.used_percent ?? window?.usedPercent ?? window?.usagePercent ?? window?.used;
  const resetAt = window?.reset_at ?? window?.resetsAt ?? window?.resetAt;
  const resetAfterSeconds = window?.reset_after_seconds ?? window?.resetAfterSeconds ?? secondsUntil(resetAt);
  const limitWindowSeconds = window?.limit_window_seconds ?? window?.limitWindowSeconds ?? minutesToSeconds(window?.windowDurationMins);
  return {
    used_percent: usedPercent,
    limit_window_seconds: limitWindowSeconds,
    reset_after_seconds: resetAfterSeconds,
    reset_at: resetAt,
  };
}

function secondsUntil(epochSeconds) {
  const value = Number(epochSeconds || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil(value - Date.now() / 1000));
}

function minutesToSeconds(minutes) {
  const value = Number(minutes || 0);
  return Number.isFinite(value) && value > 0 ? value * 60 : 0;
}

function makeWindow(label, raw, root = {}) {
  const usedPercent = clampNumber(raw?.used_percent, 0, 0, 100);
  const remainingPercent = 100 - usedPercent;
  const resetAt = Number(raw?.reset_at || 0);
  return {
    label,
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

function logInfo(event, details = {}) {
  writeLog("info", event, details);
}

function logError(event, error) {
  writeLog("error", event, {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    status: error?.status,
    stack: error?.stack ? String(error.stack).split("\n").slice(0, 4).join(" | ") : undefined,
  });
}

function writeLog(level, event, details = {}) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      event,
      ...details,
    });
    fs.appendFileSync(LOG_PATH, `${line}\n`, "utf8");
  } catch {
    // Logging must never break the Stream Deck action.
  }
}

function redactHome(value) {
  const home = os.homedir();
  return String(value || "").replace(home, "~");
}

function getIdTokenExp(auth) {
  const exp = auth?.tokens?.id_token?.exp;
  return Number.isFinite(Number(exp)) ? Number(exp) : null;
}

function summarizePayload(payload) {
  const rateLimit = payload?.rate_limit || payload?.rateLimit || {};
  return {
    topLevelKeys: Object.keys(payload || {}).slice(0, 20),
    planType: payload?.plan_type || payload?.planType || null,
    hasRateLimit: Boolean(payload?.rate_limit || payload?.rateLimit),
    hasPrimaryWindow: Boolean(rateLimit.primary_window || rateLimit.primaryWindow || payload?.primary || payload?.primaryWindow),
    hasSecondaryWindow: Boolean(rateLimit.secondary_window || rateLimit.secondaryWindow || payload?.secondary || payload?.secondaryWindow),
    secondaryWindowIsNull: rateLimit.secondary_window === null || rateLimit.secondaryWindow === null,
    additionalRateLimitsType: Array.isArray(payload?.additional_rate_limits || payload?.additionalRateLimits) ? "array" : typeof (payload?.additional_rate_limits || payload?.additionalRateLimits),
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
  const primaryPalette = palette(getLevel(snapshot.primary.remainingPercent, settings));
  const weeklyPalette = palette(getLevel(snapshot.weekly.remainingPercent, settings));
  const primary = valueFor(snapshot.primary, settings);
  const weekly = valueFor(snapshot.weekly, settings);
  const primaryWidth = Math.max(4, primary * 0.83);
  const weeklyWidth = Math.max(4, weekly * 0.83);
  return `${base(p, state)}
  <text x="23" y="45" fill="${p.text}" font-size="26" font-family="Arial, sans-serif" font-weight="800">${primary}%</text>
  <text x="110" y="33" fill="${primaryPalette.accent}" font-size="17" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">5H</text>
  <text x="110" y="53" fill="${p.text}" font-size="15" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${settings.showReset ? esc(snapshot.primary.resetText) : " "}</text>
  <line x1="24" y1="65" x2="107" y2="65" stroke="${p.track}" stroke-width="6" stroke-linecap="round"/>
  <line x1="24" y1="65" x2="${24 + primaryWidth}" y2="65" stroke="${primaryPalette.accent}" stroke-width="6" stroke-linecap="round"/>
  <text x="23" y="103" fill="${p.text}" font-size="26" font-family="Arial, sans-serif" font-weight="800">${weekly}%</text>
  <text x="110" y="91" fill="${weeklyPalette.accent}" font-size="17" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">WK</text>
  <text x="110" y="111" fill="${p.text}" font-size="15" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${settings.showReset ? esc(snapshot.weekly.resetText) : " "}</text>
  <line x1="24" y1="123" x2="107" y2="123" stroke="${p.track}" stroke-width="6" stroke-linecap="round"/>
  <line x1="24" y1="123" x2="${24 + weeklyWidth}" y2="123" stroke="${weeklyPalette.accent}" stroke-width="6" stroke-linecap="round"/>
${end()}`;
}

function renderRing(snapshot, settings, state = {}) {
  const active = selectSingleWindow(snapshot, settings, "lowest");
  const level = getLevel(active.remainingPercent, settings);
  const p = palette(level);
  const value = valueFor(active, settings);
  const arc = ringArc(72, 68, 43, Math.max(0.01, value / 100));
  return `${base(p, state)}
  <circle cx="72" cy="68" r="43" fill="none" stroke="${p.track}" stroke-width="10" stroke-linecap="round"/>
  <path d="${arc}" fill="none" stroke="${p.accent}" stroke-width="10" stroke-linecap="round"/>
  <text x="72" y="67" fill="${p.text}" font-size="28" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${value}%</text>
  <text x="72" y="85" fill="${p.text}" font-size="14" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${active.label}</text>
  <text x="72" y="113" fill="${p.text}" font-size="15" font-family="Arial, sans-serif" font-weight="800" text-anchor="middle">${settings.showReset ? esc(active.resetText) : ""}</text>
${end()}`;
}

function renderWarningTile(snapshot, settings, state = {}) {
  const active = selectSingleWindow(snapshot, settings, "lowest");
  const level = getLevel(active.remainingPercent, settings);
  const p = palette(level);
  const value = valueFor(active, settings);
  const label = active.label;
  return `${base(p, state)}
  <text x="72" y="40" fill="${p.accent}" font-size="18" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${esc(label)}</text>
  <text x="72" y="87" fill="${p.text}" font-size="47" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${value}%</text>
  <line x1="38" y1="104" x2="106" y2="104" stroke="${p.track}" stroke-width="9" stroke-linecap="round"/>
  <line x1="38" y1="104" x2="${38 + Math.max(5, value * 0.68)}" y2="104" stroke="${p.accent}" stroke-width="9" stroke-linecap="round"/>
  <text x="72" y="127" fill="${p.text}" font-size="16" font-family="Arial, sans-serif" font-weight="900" text-anchor="middle">${settings.showReset ? esc(active.resetText) : active.label}</text>
${end()}`;
}

function renderSplit(snapshot, settings, state = {}) {
  const p = palette(snapshot.level);
  const primaryPalette = palette(getLevel(snapshot.primary.remainingPercent, settings));
  const weeklyPalette = palette(getLevel(snapshot.weekly.remainingPercent, settings));
  const p1 = valueFor(snapshot.primary, settings);
  const w1 = valueFor(snapshot.weekly, settings);
  const panelFill = state.flickerOn ? p.flash : p.panel;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="28" fill="${p.bg}"/>
  <rect x="10" y="10" width="124" height="59" rx="21" fill="${panelFill}"/>
  <rect x="10" y="75" width="124" height="59" rx="21" fill="${panelFill}"/>
  <text x="24" y="35" fill="${primaryPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900">5H</text>
  <text x="24" y="59" fill="${p.text}" font-size="28" font-family="Arial, sans-serif" font-weight="900">${p1}%</text>
  <text x="122" y="56" fill="#ffffff" font-size="18" font-family="Arial, sans-serif" font-weight="900" text-anchor="end">${settings.showReset ? esc(snapshot.primary.resetText) : ""}</text>
  <text x="24" y="100" fill="${weeklyPalette.accent}" font-size="16" font-family="Arial, sans-serif" font-weight="900">WK</text>
  <text x="24" y="124" fill="${p.text}" font-size="28" font-family="Arial, sans-serif" font-weight="900">${w1}%</text>
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
  if (settings.singleWindow === "spark" && snapshot.spark?.primary) {
    return snapshot.spark.primary;
  }
  return fallback === "weekly" ? snapshot.weekly : snapshot.lowest;
}

function activeDisplayLevel(snapshot, settings) {
  if (settings.displayMode === "ring" || settings.displayMode === "warning-tile") {
    return getLevel(selectSingleWindow(snapshot, settings, "lowest").remainingPercent, settings);
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
