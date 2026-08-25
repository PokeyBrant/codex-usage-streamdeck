import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "com.statuscheck.codex-usage.sdPlugin");
const plugin = path.join(pluginRoot, "bin", "plugin.js");
if (fs.readFileSync(plugin, "utf8").includes("rate-limit-reset-credits/consume")) {
  throw new Error("display-only plugin must not include the reset consume endpoint");
}
const reviewDir = process.env.CODEX_USAGE_REVIEW_DIR || null;
const registrationInfo = JSON.stringify({
  application: {
    font: "Arial",
    language: "en",
    platform: "windows",
    platformVersion: "10",
    version: "7.1.0",
  },
  colors: {
    buttonMouseOverBackgroundColor: "#222222",
    buttonPressedBackgroundColor: "#111111",
    buttonPressedBorderColor: "#333333",
    buttonPressedTextColor: "#ffffff",
    highlightColor: "#34e977",
  },
  devicePixelRatio: 1,
  devices: [
    {
      id: "test-device",
      name: "Test Stream Deck",
      size: { columns: 5, rows: 3 },
      type: 0,
    },
  ],
  plugin: {
    uuid: "com.statuscheck.codex-usage",
    version: "0.1.12.0",
  },
});

const scenarios = [
  {
    name: "green dual bars",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "green-usage.json") },
    settings: { displayMode: "dual-bars" },
    expect: "data:image/svg+xml",
    expectStatus: {
      state: "ok",
      availableCount: null,
      applicableAvailableCount: null,
      applicableReported: false,
      sparkAvailable: false,
    },
  },
  {
    name: "visual settings rerender cached usage without refetch",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "green-usage.json") },
    settings: { displayMode: "dual-bars" },
    ephemeralMock: true,
    settingsUpdate: { displayMode: "ring", singleWindow: "weekly" },
    expectUpdatedDecodedAll: ["89%", "WK", "<path"],
  },
  {
    name: "mixed dual bars split colors",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "dual-bars", yellowThreshold: 50, redThreshold: 20, criticalThreshold: 10 },
    expectDecoded: "stroke=\"#34e977\"",
    expectDecodedAll: ["fill=\"#f6d84d\"", "fill=\"#34e977\""],
  },
  {
    name: "positive reset appears once on lowest dual bar",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json") },
    settings: { displayMode: "dual-bars" },
    expectDecodedAll: ["30m · R2", "6d", "x=\"109\" y=\"53\""],
    expectDecodedCount: [{ text: "R2", count: 1 }],
  },
  {
    name: "positive reset appears once on lowest split row",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json") },
    settings: { displayMode: "split" },
    expectDecodedAll: ["30m · R2", "6d"],
    expectDecodedCount: [{ text: "R2", count: 1 }],
  },
  {
    name: "positive reset appears on active ring window",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json") },
    settings: { displayMode: "ring", singleWindow: "primary" },
    expectDecodedAll: ["46%", "5H", "30m · R2", "A 46 46", "x=\"72\" y=\"71\"", "x=\"72\" y=\"89\"", "x=\"72\" y=\"117\"", "font-size=\"14\""],
    rejectDecodedAll: ["<circle"],
    expectDecodedCount: [{ text: "<path", count: 2 }, { text: "A 46 46", count: 2 }],
  },
  {
    name: "positive reset appears on active warning window",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "weekly" },
    expectDecodedAll: ["83%", "Week", "4 days · R2", expectedResetClock(1778551284), "x=\"72\" y=\"75\"", "font-size=\"15\"", "x1=\"30\" y1=\"91\" x2=\"113\" y2=\"91\""],
    expectDecodedCount: [{ text: "y1=\"91\"", count: 2 }],
  },
  {
    name: "positive reset warning spells singular day",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "warning-one-day-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "weekly" },
    expectDecodedAll: ["83%", "Week", "1 day · R2", expectedResetClock(1778292000), "x=\"72\" y=\"75\"", "x1=\"30\" y1=\"91\" x2=\"113\" y2=\"91\""],
    expectDecodedCount: [{ text: "y1=\"91\"", count: 2 }],
  },
  {
    name: "24 hour time rerenders cached warning usage",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "warning-one-day-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "weekly" },
    ephemeralMock: true,
    settingsUpdate: { use24HourTime: true },
    expectDecodedAll: [expectedResetClock(1778292000)],
    expectUpdatedDecodedAll: ["83%", "Week", "1 day · R2", expectedResetClock(1778292000, true)],
  },
  {
    name: "manual reset remains when countdown hidden",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json") },
    settings: { displayMode: "ring", singleWindow: "primary", showReset: false },
    expectDecodedAll: [">R2<"],
    rejectDecodedAll: ["30m · R2", ">30m<"],
  },
  {
    name: "manual reset setting hides key suffix",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json") },
    settings: { displayMode: "ring", singleWindow: "primary", showManualResets: false },
    expectDecodedAll: [">30m<"],
    rejectDecodedAll: ["R2"],
  },
  {
    name: "zero resets do not render key suffix",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-zero-usage.json") },
    settings: { displayMode: "dual-bars" },
    rejectDecodedAll: ["R0", "R1"],
    expectStatus: {
      state: "ok",
      availableCount: 0,
      applicableAvailableCount: 0,
      applicableReported: true,
      sparkAvailable: false,
    },
    expectRefreshStates: ["refreshing", "ok"],
  },
  {
    name: "banked reset remains visible when current usage needs no reset",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-banked-only-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "primary" },
    expectDecodedAll: ["30 min · R2"],
    rejectDecodedAll: ["R0", "R1"],
  },
  {
    name: "reset details layout shows banked reset and local expiration",
    env: {
      CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-banked-only-usage.json"),
      CODEX_RESET_CREDITS_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-details-available.json"),
    },
    settings: { displayMode: "reset-details" },
    expectDecodedAll: [">R1<", ">EXPIRES<", `>${expectedExpirationDate("2026-09-21T00:25:55Z").toUpperCase()}<`, "font-size=\"58\"", "font-size=\"24\"", "y=\"123\""],
    rejectDecodedAll: ["FULL RESET", "BANKED", "APPLIES NOW", expectedExpirationClock("2026-09-21T00:25:55Z"), "USE RESET", "CONFIRM"],
    expectStatus: {
      state: "ok",
      availableCount: 1,
      applicableAvailableCount: 0,
      applicableReported: true,
      detailsReported: true,
      resetTitle: "Full reset",
      resetStatus: "available",
      expiresAt: "2026-09-21T00:25:55.000Z",
      detailsError: null,
      sparkAvailable: false,
    },
  },
  {
    name: "reset details layout stays minimal when current usage applies",
    env: {
      CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-positive-usage.json"),
      CODEX_RESET_CREDITS_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-details-available.json"),
    },
    settings: { displayMode: "reset-details", use24HourTime: true },
    expectDecodedAll: [">R1<", ">EXPIRES<", `>${expectedExpirationDate("2026-09-21T00:25:55Z").toUpperCase()}<`],
    rejectDecodedAll: ["FULL RESET", "BANKED", "APPLIES NOW", expectedExpirationClock("2026-09-21T00:25:55Z", true)],
  },
  {
    name: "reset details layout shows no reset",
    env: {
      CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-zero-usage.json"),
      CODEX_RESET_CREDITS_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-details-empty.json"),
    },
    settings: { displayMode: "reset-details" },
    expectDecodedAll: [">NONE<", "NO RESET AVAILABLE"],
    rejectDecodedAll: ["R0", "USE RESET"],
  },
  {
    name: "malformed reset details retain normalized usage count",
    env: {
      CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-banked-only-usage.json"),
      CODEX_RESET_CREDITS_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-details-malformed.json"),
    },
    settings: { displayMode: "reset-details" },
    expectDecodedAll: [">R2<", "EXPIRY NOT REPORTED"],
    rejectDecodedAll: ["USAGE RESET", "BANKED", "not-a-date", "USE RESET"],
    expectStatus: {
      state: "ok",
      availableCount: 2,
      detailsReported: true,
      resetTitle: null,
      expiresAt: null,
      detailsError: null,
      sparkAvailable: false,
    },
  },
  {
    name: "reset details failure preserves banked count",
    env: {
      CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-banked-only-usage.json"),
      CODEX_RESET_CREDITS_MOCK_ERROR: "ENDPOINT",
    },
    settings: { displayMode: "reset-details" },
    expectDecodedAll: [">R2<", "DETAILS UNAVAILABLE"],
    rejectDecodedAll: ["BANKED"],
    expectStatus: {
      state: "ok",
      availableCount: 2,
      detailsReported: false,
      detailsError: "ENDPOINT",
      sparkAvailable: false,
    },
  },
  {
    name: "malformed reset counts are not reported",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "reset-malformed-usage.json") },
    settings: { displayMode: "dual-bars" },
    rejectDecodedAll: ["R0", "R1", "R2"],
    expectStatus: {
      state: "ok",
      availableCount: null,
      applicableAvailableCount: null,
      applicableReported: true,
      sparkAvailable: false,
    },
  },
  {
    name: "weekly-only dual bars shows five-hour open",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "weekly-only-usage.json") },
    settings: { displayMode: "dual-bars" },
    expectDecodedAll: ["OPEN", "81%", "5H", "WK", "x=\"116\" y=\"33\""],
    rejectDecodedAll: ["CHANGED"],
    expectStatus: {
      state: "ok",
      availableCount: 1,
      applicableAvailableCount: null,
      applicableReported: false,
      sparkAvailable: true,
    },
  },
  {
    name: "weekly-only split shows five-hour open",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "weekly-only-usage.json") },
    settings: { displayMode: "split" },
    expectDecodedAll: ["OPEN", "81%", "5H", "WK"],
  },
  {
    name: "weekly-only auto ring selects weekly",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "weekly-only-usage.json") },
    settings: { displayMode: "ring", singleWindow: "auto" },
    expectDecodedAll: ["81%", "WK"],
    rejectDecodedAll: ["OPEN"],
  },
  {
    name: "weekly-only explicit five-hour warning shows open",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "weekly-only-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "primary" },
    expectDecodedAll: ["OPEN", "5 Hours"],
    rejectDecodedAll: ["81%"],
  },
  {
    name: "weekly-only spark selection uses available window",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "weekly-only-usage.json") },
    settings: { displayMode: "ring", singleWindow: "spark" },
    expectDecodedAll: ["63%", "SP"],
  },
  {
    name: "five-hour-only dual bars shows weekly open",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "five-hour-only-usage.json") },
    settings: { displayMode: "dual-bars" },
    expectDecodedAll: ["54%", "OPEN", "5H", "WK"],
  },
  {
    name: "critical warning tile",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "critical-usage.json") },
    settings: { displayMode: "warning-tile", redThreshold: 20, criticalThreshold: 10 },
    expectDecoded: "8%",
  },
  {
    name: "ring can show weekly",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "critical-usage.json") },
    settings: { displayMode: "ring", singleWindow: "weekly" },
    expectDecodedAll: ["82%", "WK", "A 46 46", "x=\"72\" y=\"71\"", "x=\"72\" y=\"89\"", "x=\"72\" y=\"117\"", "font-size=\"17\""],
    rejectDecodedAll: ["<circle"],
    expectDecodedCount: [{ text: "<path", count: 2 }, { text: "A 46 46", count: 2 }],
  },
  {
    name: "warning tile can show primary",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "primary" },
    expectDecodedAll: ["46%", "5 Hours", "30 min", expectedResetClock(1778150000), "x=\"72\" y=\"75\"", "font-size=\"17\"", "x1=\"30\" y1=\"91\" x2=\"113\" y2=\"91\""],
    expectDecodedCount: [{ text: "y1=\"91\"", count: 2 }],
  },
  {
    name: "ring can show spark limit as selected single icon",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "spark-usage.json") },
    settings: { displayMode: "ring", singleWindow: "spark" },
    expectDecodedAll: ["62%", "SP"],
    rejectDecodedAll: ["R1"],
  },
  {
    name: "unused spark ring fits 100 percent",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "spark-unused-usage.json") },
    settings: { displayMode: "ring", singleWindow: "spark" },
    expectDecodedAll: ["100%", "SP", "font-size=\"27\""],
    rejectDecodedAll: ["R1"],
  },
  {
    name: "legacy spark checkbox maps to selected single icon",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "spark-usage.json") },
    settings: { displayMode: "warning-tile", showSpark: true },
    expectDecodedAll: ["62%", "Spark"],
  },
  {
    name: "split reset text is white and right aligned",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "split" },
    expectDecodedAll: ["x=\"122\" y=\"35\" fill=\"#ffffff\" font-size=\"18\"", "text-anchor=\"end\">30m"],
  },
  {
    name: "yellow threshold can flicker at configured interval",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "dual-bars", yellowFlicker: true, yellowFlickerSeconds: 1 },
    expectSecondImageDecodedAll: ["fill=\"#3c3518\""],
  },
  {
    name: "red threshold can flicker at configured interval",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "critical-usage.json") },
    settings: { displayMode: "warning-tile", redFlicker: true, redFlickerSeconds: 1, criticalThreshold: 1 },
    expectSecondImageDecodedAll: ["fill=\"#3a2416\""],
  },
  {
    name: "critical threshold can flicker at configured interval",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "critical-usage.json") },
    settings: { displayMode: "ring", criticalFlicker: true, criticalFlickerSeconds: 1 },
    expectSecondImageDecodedAll: ["fill=\"#3b1630\""],
  },
  {
    name: "mood and plan settings do not render",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "critical-usage.json") },
    settings: { displayMode: "ring", singleWindow: "primary", moodEnabled: true, showPlan: true },
    rejectDecodedAll: ["OH NO", "PRO"],
  },
  {
    name: "legacy weekly tile maps to weekly ring",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "weekly-tile" },
    expectDecodedAll: ["83%", "WK"],
  },
  {
    name: "missing login",
    env: { CODEX_USAGE_MOCK_ERROR: "LOGIN" },
    settings: {},
    expectDecoded: "LOGIN",
    expectStatus: { state: "error", errorCode: "LOGIN" },
  },
  {
    name: "auth expired",
    env: { CODEX_USAGE_MOCK_ERROR: "AUTH" },
    settings: {},
    expectDecoded: "EXPIRED",
  },
  {
    name: "endpoint changed",
    env: { CODEX_USAGE_MOCK_ERROR: "ENDPOINT" },
    settings: {},
    expectDecoded: "CHANGED",
  },
  {
    name: "unrecognized successful payload shows endpoint changed",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "unrecognized-usage.json") },
    settings: {},
    expectDecoded: "CHANGED",
  },
];

for (const scenario of scenarios) {
  await runScenario(scenario);
}

console.log(`ok ${scenarios.length} scenarios`);

async function runScenario(scenario) {
  const port = await freePort();
  const server = new WebSocketServer({ port });
  const childEnv = { ...process.env, ...scenario.env };
  let ephemeralMockPath = null;
  if (scenario.ephemeralMock && childEnv.CODEX_USAGE_MOCK_PAYLOAD) {
    ephemeralMockPath = path.join(os.tmpdir(), `codex-usage-${process.pid}-${Date.now()}.json`);
    fs.copyFileSync(childEnv.CODEX_USAGE_MOCK_PAYLOAD, ephemeralMockPath);
    childEnv.CODEX_USAGE_MOCK_PAYLOAD = ephemeralMockPath;
  }
  const child = spawn(process.execPath, [
    plugin,
    "-port", String(port),
    "-info", registrationInfo,
    "-pluginUUID", "com.statuscheck.codex-usage",
    "-registerEvent", "registerPlugin",
  ], {
    cwd: pluginRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childStdout = "";
  let childStderr = "";
  child.stdout.on("data", (chunk) => {
    childStdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    childStderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    child.kill();
    server.close();
  }, 10000);

  try {
    const [socket] = await waitForConnection(server, child, scenario, () => childStdout, () => childStderr);
    await once(socket, "message");
    socket.send(JSON.stringify({
      event: "willAppear",
      action: "com.statuscheck.codex-usage.usage",
      context: "test-context",
      device: "test-device",
      payload: {
        controller: "Keypad",
        coordinates: { column: 0, row: 0 },
        settings: scenario.settings,
      },
    }));

    const imageMessage = await waitFor(socket, (message) => message.event === "setImage");
    const image = imageMessage.payload?.image || "";
    const decoded = decodeURIComponent(image.replace(/^data:image\/svg\+xml,/, ""));

    if (reviewDir && (
      scenario.name.startsWith("positive reset")
      || scenario.name.startsWith("reset details layout")
      || scenario.name === "24 hour time rerenders cached warning usage"
      || scenario.name === "ring can show weekly"
      || scenario.name === "warning tile can show primary"
      || scenario.name === "unused spark ring fits 100 percent"
    )) {
      fs.mkdirSync(reviewDir, { recursive: true });
      const reviewName = `${scenario.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.svg`;
      fs.writeFileSync(path.join(reviewDir, reviewName), decoded, "utf8");
    }

    if (scenario.expect && !image.startsWith(scenario.expect)) {
      throw new Error(`${scenario.name}: expected image prefix ${scenario.expect}`);
    }
    if (scenario.expectDecoded && !decoded.includes(scenario.expectDecoded)) {
      throw new Error(`${scenario.name}: expected decoded SVG to include ${scenario.expectDecoded}`);
    }
    for (const expected of scenario.expectDecodedAll || []) {
      if (!decoded.includes(expected)) {
        throw new Error(`${scenario.name}: expected decoded SVG to include ${expected}`);
      }
    }
    for (const rejected of scenario.rejectDecodedAll || []) {
      if (decoded.includes(rejected)) {
        throw new Error(`${scenario.name}: expected decoded SVG not to include ${rejected}`);
      }
    }
    for (const expected of scenario.expectDecodedCount || []) {
      const count = countOccurrences(decoded, expected.text);
      if (count !== expected.count) {
        throw new Error(`${scenario.name}: expected ${expected.text} ${expected.count} time(s), found ${count}`);
      }
    }
    if (scenario.expectStatus) {
      const statusPromise = waitFor(socket, isUsageStatusMessage);
      socket.send(JSON.stringify({
        event: "propertyInspectorDidAppear",
        action: "com.statuscheck.codex-usage.usage",
        context: "test-context",
        device: "test-device",
      }));
      const statusMessage = await statusPromise;
      assertStatus(scenario, statusMessage.payload, scenario.expectStatus);

      const requestedStatusPromise = waitFor(socket, isUsageStatusMessage);
      socket.send(JSON.stringify({
        event: "sendToPlugin",
        action: "com.statuscheck.codex-usage.usage",
        context: "test-context",
        payload: { type: "request-status" },
      }));
      const requestedStatusMessage = await requestedStatusPromise;
      assertStatus(scenario, requestedStatusMessage.payload, scenario.expectStatus);
    }
    if (scenario.expectRefreshStates) {
      const statusesPromise = waitForSequence(socket, isUsageStatusMessage, scenario.expectRefreshStates.length);
      socket.send(JSON.stringify({
        event: "sendToPlugin",
        action: "com.statuscheck.codex-usage.usage",
        context: "test-context",
        payload: { type: "refresh" },
      }));
      const statuses = await statusesPromise;
      const states = statuses.map((message) => message.payload.state);
      if (JSON.stringify(states) !== JSON.stringify(scenario.expectRefreshStates)) {
        throw new Error(`${scenario.name}: expected refresh states ${scenario.expectRefreshStates}, found ${states}`);
      }
    }
    if (scenario.settingsUpdate) {
      if (ephemeralMockPath && fs.existsSync(ephemeralMockPath)) {
        fs.rmSync(ephemeralMockPath);
      }
      const updatedImagePromise = waitFor(socket, (message) => message.event === "setImage");
      socket.send(JSON.stringify({
        event: "didReceiveSettings",
        action: "com.statuscheck.codex-usage.usage",
        context: "test-context",
        device: "test-device",
        payload: { settings: { ...scenario.settings, ...scenario.settingsUpdate } },
      }));
      const updatedImageMessage = await updatedImagePromise;
      const updatedImage = updatedImageMessage.payload?.image || "";
      const updatedDecoded = decodeURIComponent(updatedImage.replace(/^data:image\/svg\+xml,/, ""));
      if (reviewDir && scenario.name === "24 hour time rerenders cached warning usage") {
        fs.mkdirSync(reviewDir, { recursive: true });
        fs.writeFileSync(path.join(reviewDir, "warning-tile-24-hour-time.svg"), updatedDecoded, "utf8");
      }
      for (const expected of scenario.expectUpdatedDecodedAll || []) {
        if (!updatedDecoded.includes(expected)) {
          throw new Error(`${scenario.name}: expected updated SVG to include ${expected}`);
        }
      }
    }
    if (scenario.expectSecondImageDecodedAll) {
      const secondImageMessage = await waitFor(socket, (message) => message.event === "setImage");
      const secondImage = secondImageMessage.payload?.image || "";
      const secondDecoded = decodeURIComponent(secondImage.replace(/^data:image\/svg\+xml,/, ""));
      for (const expected of scenario.expectSecondImageDecodedAll) {
        if (!secondDecoded.includes(expected)) {
          throw new Error(`${scenario.name}: expected second decoded SVG to include ${expected}`);
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    child.kill();
    server.close();
    if (ephemeralMockPath && fs.existsSync(ephemeralMockPath)) {
      fs.rmSync(ephemeralMockPath);
    }
  }
}

function isUsageStatusMessage(message) {
  return message.event === "sendToPropertyInspector" && message.payload?.type === "usage-status";
}

function assertStatus(scenario, actual, expected) {
  const checks = {
    state: actual.state,
    errorCode: actual.errorCode,
    availableCount: actual.resetCredits?.availableCount,
    applicableAvailableCount: actual.resetCredits?.applicableAvailableCount,
    applicableReported: actual.resetCredits?.applicableReported,
    detailsReported: actual.resetCredits?.detailsReported,
    resetTitle: actual.resetCredits?.title,
    resetStatus: actual.resetCredits?.status,
    expiresAt: actual.resetCredits?.expiresAt,
    detailsError: actual.resetCredits?.detailsError,
    sparkAvailable: actual.capabilities?.sparkAvailable,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (checks[key] !== value) {
      throw new Error(`${scenario.name}: expected status ${key}=${value}, found ${checks[key]}`);
    }
  }
  if (expected.state === "ok" && typeof actual.lastUpdatedAt !== "string") {
    throw new Error(`${scenario.name}: expected successful status timestamp`);
  }
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function expectedResetClock(timestamp, use24HourTime = false) {
  return new Intl.DateTimeFormat(undefined, {
    hour: use24HourTime ? "2-digit" : "numeric",
    minute: "2-digit",
    ...(use24HourTime ? { hourCycle: "h23" } : { hour12: true }),
  }).format(new Date(timestamp * 1000));
}

function expectedExpirationDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function expectedExpirationClock(timestamp, use24HourTime = false) {
  return new Intl.DateTimeFormat(undefined, {
    hour: use24HourTime ? "2-digit" : "numeric",
    minute: "2-digit",
    ...(use24HourTime ? { hourCycle: "h23" } : { hour12: true }),
  }).format(new Date(timestamp));
}

function waitForConnection(server, child, scenario, stdout, stderr) {
  return Promise.race([
    once(server, "connection"),
    once(child, "exit").then(([code, signal]) => {
      throw new Error(`${scenario.name}: plugin exited before connecting code=${code} signal=${signal}\nstdout:\n${stdout()}\nstderr:\n${stderr()}`);
    }),
  ]);
}

function waitFor(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for plugin message"));
    }, 5000);

    function onMessage(data) {
      const message = JSON.parse(String(data));
      if (predicate(message)) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(message);
      }
    }

    socket.on("message", onMessage);
  });
}

function waitForSequence(socket, predicate, count) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${count} matching messages; received ${messages.length}`));
    }, 5000);

    function onMessage(data) {
      const message = JSON.parse(String(data));
      if (!predicate(message)) {
        return;
      }
      messages.push(message);
      if (messages.length === count) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(messages);
      }
    }

    socket.on("message", onMessage);
  });
}

async function freePort() {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
