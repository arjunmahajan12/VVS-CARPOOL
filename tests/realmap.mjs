// Loads the REAL Mappls SDK by serving the built app at the whitelisted origin
// (requests to that origin are answered from dist/ by Playwright; everything
// else — sdk.mappls.com, apis.mappls.com, OSRM — goes to the network).
// Usage: MAPPLS_KEY=<map sdk key> ORIGIN=<whitelisted https origin> node tests/realmap.mjs  (SKIP_BUILD=1 reuses the last build)
import { chromium } from "/home/claude/vvs-carpool-app/node_modules/playwright-core/index.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs"; import path from "node:path";
const ROOT = "/home/claude/vvs-carpool-app";
const OUT = "/tmp/claude-0/-home-claude/b628ee9e-2563-5e4d-8342-edc199c9764d/scratchpad/realmap";
fs.mkdirSync(OUT, { recursive: true });
const DIST = `${OUT}/dist`;
const ORIGIN = process.env.ORIGIN || "https://vvs-carpool.arjunm-ddb.workers.dev";
const KEY = process.env.MAPPLS_KEY;
if (!KEY) { console.log("MAPPLS_KEY missing"); process.exit(2); }
if (!process.env.SKIP_BUILD) execSync(`VITE_MAPPLS_KEY=${KEY} npx vite build --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome").toString().trim();
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, geolocation: { latitude: 28.5452, longitude: 77.1541 }, permissions: ["geolocation"] });
const p = await ctx.newPage();
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
await p.route(`${ORIGIN}/**`, (r) => {
  const u = new URL(r.request().url()); let f = path.join(DIST, u.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  r.fulfill({ status: 200, contentType: mime[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
});
await p.addInitScript(() => { window.__vvsDebugMap = true; });
await p.addInitScript(() => {
  let real; Object.defineProperty(window, "mappls", { configurable: true, get() { return real; }, set(v) { real = v; if (v && typeof v.Map === "function" && !v.__wrapped) { const M = v.Map; v.Map = function (...a) { const m = M.apply(this, a); window.__vvsMap = m; window.__vvsMapAt = performance.now(); return m; }; v.__wrapped = true; } } });
});
const net = [];
p.on("requestfailed", (rq) => { if (/mappls/.test(rq.url())) net.push(`FAILED ${rq.failure()?.errorText} ${rq.url().slice(0, 110)}`); });
p.on("request", (rq) => { if (/mappls|nominatim/.test(rq.url())) net.push(`REQ ${rq.url().slice(0, 120)}`); });
p.on("response", (res) => { const u = res.url(); if (/mappls\.com/.test(u)) net.push(`${res.status()} ${u.slice(0, 110)}`); });
p.on("console", (m) => { if (m.type() === "error") net.push("console: " + m.text().slice(0, 160)); });
p.on("pageerror", (e) => net.push("pageerror: " + e.message.slice(0, 160)));

await p.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" }); await wait(1500);
await p.getByPlaceholder("you@example.com").fill("asha@demo.in");
await p.getByRole("button", { name: "Sign in", exact: true }).click(); await wait(1500);
const acc = p.getByRole("button", { name: /I accept the updated terms/ }); if (await acc.count()) { await acc.click(); await wait(800); }
await p.getByRole("button", { name: /^Discover/ }).first().click();
{ const t0 = Date.now(); let sdkAt = null, readyAt = null, mapAt = null, loadedAt = null, styleAt = null; while (Date.now() - t0 < 20000) {
    const mm = await p.evaluate(() => { const m = window.__vvsMap; return m ? { has: true, loaded: (() => { try { return m.loaded(); } catch { return "err"; } })(), style: (() => { try { return m.isStyleLoaded(); } catch { return "err"; } })() } : { has: false }; });
    if (mm.has && mapAt == null) mapAt = Date.now() - t0; if (mm.loaded === true && loadedAt == null) loadedAt = Date.now() - t0; if (mm.style === true && styleAt == null) styleAt = Date.now() - t0;
    if (Date.now() - t0 > 12000 && readyAt == null) { console.log("timeline mapAt", mapAt, "styleAt", styleAt, "loadedAt", loadedAt); } const st = await p.evaluate(() => ({ sdk: typeof window.mappls?.Map === "function", canvas: !!document.querySelector("canvas"), skel: Array.from(document.querySelectorAll('[aria-hidden]')).filter((e) => /Loading map/.test(e.textContent || "")).map((e) => getComputedStyle(e).opacity)[0] })); if (st.sdk && sdkAt == null) sdkAt = Date.now() - t0; if (st.skel === "0" && readyAt == null) { readyAt = Date.now() - t0; } if (readyAt != null && loadedAt != null) break; await wait(200); } console.log("sdk ready after", sdkAt, "ms; map created", mapAt, "ms; style loaded", styleAt, "ms; loaded()", loadedAt, "ms; skeleton hidden after", readyAt, "ms"); }
await wait(1000);
console.log("map object", await p.evaluate(() => { const m = window.__vvsMap; if (!m) return null; const names = new Set(); let o = m; while (o && o !== Object.prototype) { Object.getOwnPropertyNames(o).forEach((n) => names.add(n)); o = Object.getPrototypeOf(o); } return { keys: Array.from(names).filter((n) => /load|style|ready|idle|once|on$/i.test(n)).slice(0, 40), loaded: typeof m.loaded === "function" ? m.loaded() : "n/a", styleLoaded: typeof m.isStyleLoaded === "function" ? m.isStyleLoaded() : "n/a", ctor: m.constructor?.name }; }));
await p.screenshot({ path: `${OUT}/discover-4s.png` });
const skel = async () => p.evaluate(() => { const els = Array.from(document.querySelectorAll('[aria-hidden]')).filter((e) => /Loading map/.test(e.textContent || "")); return els.map((e) => getComputedStyle(e).opacity + "/" + e.className.slice(0, 60)); });
console.log("skeleton@4s", await skel());
await wait(10000);
console.log("skeleton@14s", await skel(), "canvases", await p.evaluate(() => document.querySelectorAll("canvas").length));
const tiles = net.filter((l) => /^\d{3} .*tile\.mappls/.test(l)); console.log("tile responses", tiles.length, tiles.slice(0, 3));
const m = await p.evaluate(() => {
  const holder = document.querySelector('[aria-label="Map"]');
  const canvas = holder?.querySelector("canvas");
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) }; };
  const inner = holder ? Array.from(holder.children).map((c) => ({ tag: c.tagName, cls: String(c.className).slice(0, 60), style: c.getAttribute("style")?.slice(0, 120), r: r(c) })) : [];
  const cs = holder ? getComputedStyle(holder) : null;
  const parent = holder?.parentElement;
  const rules = []; try { for (const ss of document.styleSheets) { let rs; try { rs = ss.cssRules; } catch { continue; } for (const rule of rs) { if (rule.selectorText && holder?.matches(rule.selectorText) && /height|position|inset|top|bottom/.test(rule.cssText)) rules.push(rule.cssText.slice(0, 200)); } } } catch {}
  return { holderClass: holder?.className, holderComputed: cs && { position: cs.position, height: cs.height, top: cs.top, bottom: cs.bottom, inset: cs.inset }, parent: parent && { cls: String(parent.className).slice(0, 80), r: r(parent) }, matchedRules: rules, holder: r(holder), holderStyle: holder?.getAttribute("style"), canvas: r(canvas), canvasAttr: canvas ? { w: canvas.width, h: canvas.height, style: canvas.getAttribute("style") } : null, inner, sdk: typeof window.mappls, hasMap: typeof window.mappls?.Map };
});
console.log(JSON.stringify(m, null, 1));
console.log(net.slice(0, 15).join("\n"));
await p.screenshot({ path: `${OUT}/discover.png` });

// ---- real address search in the onboarding picker ---------------------------
await p.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" }); await wait(1200);
await p.getByPlaceholder("you@example.com").fill("realpicker@demo.in");
await p.getByRole("button", { name: "Sign in", exact: true }).click(); await wait(1200);
await p.getByPlaceholder(/Asha Mehta|Your name|name/i).first().fill("Real Picker");
const ph = p.getByPlaceholder(/\+91|phone/i).first(); if (await ph.count()) await ph.fill("+91 99999 00000");
const ch = p.getByPlaceholder(/child.*name|Child's name/i).first(); if (await ch.count()) await ch.fill("Kid");
await p.getByRole("button", { name: /Continue/ }).first().click(); await wait(1000);
const queries = process.env.QUERIES ? process.env.QUERIES.split("|") : ["Bhardwaj Homeopathy", "Vasant Kunj Sector C", "DLF Promenade"];
for (const q of queries) {
  const box = p.getByPlaceholder(/Search your address|Search/i).first();
  await box.fill(""); await box.fill(q);
  const opt = p.locator('[role="option"]').first();
  let sugs = [];
  try { await opt.waitFor({ state: "visible", timeout: 15000 }); sugs = await p.locator('[role="option"]').allInnerTexts(); } catch { console.log(`"${q}": no suggestions within 15 s`); continue; }
  console.log(`"${q}": ${sugs.length} suggestions; first = ${sugs[0].replace(/\s+/g, " ").slice(0, 90)}`);
  const nomBefore = net.filter((l) => /nominatim/.test(l)).length;
  const pinOf = async () => p.evaluate(() => { const el = document.querySelector("[data-pin-lat]"); return el ? el.getAttribute("data-pin-lat") + "," + el.getAttribute("data-pin-lng") : null; });
  const before = await pinOf();
  const t0 = Date.now();
  await opt.click();
  let outcome = "timeout";
  while (Date.now() - t0 < 30000) { const t = (await p.innerText("body")).replace(/\s+/g, " "); const now = await pinOf(); if (/Couldn't get coordinates/.test(t)) { outcome = "ERROR"; break; } if (/only place the pin near/.test(t)) { outcome = "approx"; break; } if (now && now !== before) { outcome = "pinned"; break; } await wait(200); }
  const now = await pinOf();
  console.log(`   → ${outcome} after ${Date.now() - t0} ms; geocoder calls: ${net.filter((l) => /nominatim/.test(l)).length - nomBefore}; pin ${before} → ${now}`);
  await p.screenshot({ path: `${OUT}/pick-${q.replace(/\W+/g, "_")}.png` });
}
await browser.close();
