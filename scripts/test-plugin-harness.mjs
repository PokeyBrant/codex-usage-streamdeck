import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "com.statuscheck.codex-usage.sdPlugin");
const plugin = path.join(pluginRoot, "bin", "plugin.js");
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
    version: "0.1.11.0",
  },
});

const scenarios = [
  {
    name: "green dual bars",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "green-usage.json") },
    settings: { displayMode: "dual-bars" },
    expect: "data:image/svg+xml",
  },
  {
    name: "mixed dual bars split colors",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "dual-bars", yellowThreshold: 50, redThreshold: 20, criticalThreshold: 10 },
    expectDecoded: "stroke=\"#34e977\"",
    expectDecodedAll: ["fill=\"#f6d84d\"", "fill=\"#34e977\""],
  },
  {
    name: "weekly-only dual bars shows five-hour open",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "weekly-only-usage.json") },
    settings: { displayMode: "dual-bars" },
    expectDecodedAll: ["OPEN", "81%", "5H", "WK", "x=\"116\" y=\"33\""],
    rejectDecodedAll: ["CHANGED"],
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
    expectDecodedAll: ["OPEN", "5H"],
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
    expectDecodedAll: ["82%", "WK"],
  },
  {
    name: "warning tile can show primary",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "warning-tile", singleWindow: "primary" },
    expectDecodedAll: ["46%", "5H"],
  },
  {
    name: "ring can show spark limit as selected single icon",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "spark-usage.json") },
    settings: { displayMode: "ring", singleWindow: "spark" },
    expectDecodedAll: ["62%", "SP"],
  },
  {
    name: "legacy spark checkbox maps to selected single icon",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "spark-usage.json") },
    settings: { displayMode: "warning-tile", showSpark: true },
    expectDecodedAll: ["62%", "SP"],
  },
  {
    name: "split reset text is white and right aligned",
    env: { CODEX_USAGE_MOCK_PAYLOAD: path.join(root, "test-fixtures", "mixed-usage.json") },
    settings: { displayMode: "split" },
    expectDecodedAll: ["x=\"122\" y=\"56\" fill=\"#ffffff\" font-size=\"18\"", "text-anchor=\"end\">30m"],
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
  const child = spawn(process.execPath, [
    plugin,
    "-port", String(port),
    "-info", registrationInfo,
    "-pluginUUID", "com.statuscheck.codex-usage",
    "-registerEvent", "registerPlugin",
  ], {
    cwd: pluginRoot,
    env: { ...process.env, ...scenario.env },
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
  }
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

async function freePort() {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
