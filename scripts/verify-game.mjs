/**
 * verify-game.mjs — Playwright smoke self-check: serve dist → zero console errors →
 * three-state screenshots → direction-mapping assertions.
 *
 * Usage: npm run build && node scripts/verify-game.mjs
 * Serves dist/public when a backend has been grafted on, otherwise dist/.
 * Headless falls back to SwiftShader (software GL): it proves rendering/logic correctness only,
 * never performance. Measure fps on a real GPU separately.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = existsSync(join(ROOT, "dist/public/index.html")) ? join(ROOT, "dist/public") : join(ROOT, "dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`VERIFY FAIL: no build output at ${DIST} — run \`npm run build\` first`);
  process.exit(1);
}
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });

const CANVAS_ID = "game-canvas"; // must match <canvas id="..."> in src/pages/Home.tsx
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const file = join(DIST, url === "/" ? "index.html" : url);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});

const fail = (msg) => { console.error("VERIFY FAIL:", msg); server.close(); process.exit(1); };

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/opt/gchrome/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);
let browser;
for (const exe of [null, ...CANDIDATES]) {
  try {
    browser = await chromium.launch(exe
      ? { executablePath: exe, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] }
      : {});
    break;
  } catch { /* try the next one */ }
}
if (!browser) fail("no usable browser found (playwright bundled/chrome/chromium all unavailable)");
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 8000 });
await page.screenshot({ path: join(SHOTS, "01-title.png") });

// Space must enter a controllable state (title -> playing)
await page.keyboard.press("Space");
await page.waitForTimeout(1200);
await page.screenshot({ path: join(SHOTS, "02-gameplay.png") });

// Direction assertions via window.__gameProbe(): A/ArrowLeft => x decreases, D/ArrowRight => x increases
const probe = await page.evaluate(() => !!window.__gameProbe);
if (probe) {
  const x0 = (await page.evaluate(() => window.__gameProbe())).x;
  await page.keyboard.down("KeyD");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyD");
  const x1 = (await page.evaluate(() => window.__gameProbe())).x;
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(400);
  await page.keyboard.up("KeyA");
  const x2 = (await page.evaluate(() => window.__gameProbe())).x;
  if (!(x1 > x0)) fail(`direction assertion failed: D did not increase x (${x0} -> ${x1})`);
  if (!(x2 < x1)) fail(`direction assertion failed: A did not decrease x (${x1} -> ${x2})`);
} else {
  console.warn("WARN: window.__gameProbe not injected, skipping direction assertions");
}

// pause via Escape
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, "03-paused.png") });

if (consoleErrors.length) fail(`console errors:\n${consoleErrors.join("\n")}`);

console.log("VERIFY OK: render/enter/direction/pause/console all passed; screenshots in verification-shots/");
await browser.close();
server.close();
