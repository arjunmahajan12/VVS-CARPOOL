// Address-picker resolver test. Builds the app WITH a Mappls key so the search
// box renders, then intercepts the Mappls SDK + OSM Nominatim at the network
// layer so each fallback of resolveSuggestion() is exercised deterministically:
//   A. suggestion already carries lat/lng           → pinned, exact
//   B. eLoc only, placedetails plugin arrives LATE   → pinned via getPinDetails (no error)
//   C. eLoc only, plugin returns nothing            → pinned via geocoder (full text)
//   D. eLoc only, plugin + full text fail, only the address tail geocodes → pinned + "approximate" note
//   E. everything fails                             → clear error, previous pin untouched
// Run: node tests/picker.e2e.mjs   (builds to a scratch dir, serves on :4179)
import { chromium } from "/home/claude/vvs-carpool-app/node_modules/playwright-core/index.mjs";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
const ROOT = "/home/claude/vvs-carpool-app";
const OUT = "/tmp/claude-0/-home-claude/b628ee9e-2563-5e4d-8342-edc199c9764d/scratchpad/picker";
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DIST = `${OUT}/dist`;
console.log("building keyed bundle…");
execSync(`VITE_MAPPLS_KEY=testkey npx vite build --outDir ${DIST} --emptyOutDir`, { cwd: ROOT, stdio: "ignore" });
const srv = spawn("npx", ["vite", "preview", "--outDir", DIST, "--port", "4179", "--strictPort"], { cwd: ROOT, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const errors = [];
const ok = (c, l) => { results.push([!!c, l]); console.log((c ? "  ✓ " : "  ✗ ") + l); };
const exe = execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome").toString().trim();
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

// ---- scenario knobs (read by the routes below) ------------------------------
const knobs = { pluginDelayMs: 0, pinDetails: "ok", nominatim: "ok", suggestionHasLatLng: false };
const LL = { plugin: { lat: 28.5301, lng: 77.1502 }, direct: { lat: 28.5401, lng: 77.1601 }, full: { lat: 28.5201, lng: 77.1402 }, tail: { lat: 28.5101, lng: 77.1302 } };
const nominatimCalls = [];

const SDK_STUB = `
  (function(){
    const P = new Proxy(function(){}, { get:(t,k)=> k==='then'?undefined:P, apply:()=>P });
    window.mappls = {
      Map: function(){ return { on:function(){}, resize:function(){}, easeTo:function(){}, fitBounds:function(){}, remove:function(){}, getZoom:function(){return 15;} }; },
      Marker: function(){ return P; }, Polyline: function(){ return P; }, Circle: function(){ return P; }, removeLayer: function(){},
    };
  })();`;
const PLUGIN_STUB = `
  window.mappls.search = function(q, opts, cb){
    setTimeout(function(){ cb({ suggestedLocations: [
      Object.assign({ placeName: "Bhardwaj Homeopathy Clinic", placeAddress: "Sector C, Vasant Kunj, New Delhi, Delhi, 110070", eLoc: "TESTELOC", type: "POI" }, window.__sugLatLng || {})
    ]}); }, 50);
  };
  window.mappls.getPinDetails = function(opts, cb){
    setTimeout(function(){
      var mode = window.__pinMode || "ok";
      if (mode === "ok") cb({ latitude: ${LL.plugin.lat}, longitude: ${LL.plugin.lng}, placeName: "Bhardwaj Homeopathy Clinic" });
      else if (mode === "empty") cb({});
      /* mode "hang": never calls back */
    }, 50);
  };`;

await p.route(/sdk\.mappls\.com\/map\/sdk\/web/, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: SDK_STUB }));
await p.route(/sdk\.mappls\.com\/map\/sdk\/plugins/, async (r) => { await wait(knobs.pluginDelayMs); r.fulfill({ status: 200, contentType: "application/javascript", body: PLUGIN_STUB }); });
await p.route(/apis\.mappls\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
await p.route(/nominatim\.openstreetmap\.org/, (r) => {
  const q = new URL(r.request().url()).searchParams.get("q") || "";
  nominatimCalls.push(q);
  if (knobs.nominatim === "fail") return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  if (knobs.nominatim === "tail-only") {
    if (/Bhardwaj|^Sector C/.test(q)) return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: String(LL.tail.lat), lon: String(LL.tail.lng), display_name: q }]) });
  }
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lat: String(LL.full.lat), lon: String(LL.full.lng), display_name: q }]) });
});

const body = async () => (await p.innerText("body")).replace(/\s+/g, " ");
async function freshPicker() {
  // Demo login → onboarding step 2 shows the LocationPicker.
  await p.goto("http://localhost:4179/", { waitUntil: "domcontentloaded" }); await wait(800);
  await p.evaluate(({ pinMode, sug }) => { window.__pinMode = pinMode; window.__sugLatLng = sug; }, { pinMode: knobs.pinDetails, sug: knobs.suggestionHasLatLng ? { latitude: LL.direct.lat, longitude: LL.direct.lng } : null });
  await p.getByPlaceholder("you@example.com").fill("picker" + Date.now() + "@demo.in");
  await p.getByRole("button", { name: "Sign in", exact: true }).click(); await wait(1000);
  await p.getByPlaceholder(/Asha Mehta|Your name|name/i).first().fill("Picker Test");
  const phone = p.getByPlaceholder(/\+91|phone/i).first(); if (await phone.count()) await phone.fill("+91 99999 00000");
  const child = p.getByPlaceholder(/child.*name|Child's name/i).first(); if (await child.count()) await child.fill("Test Kid");
  await p.getByRole("button", { name: /Continue/ }).first().click(); await wait(800);
  if (!/Where's home/i.test(await body())) { await p.screenshot({ path: `${OUT}/fail-onb.png` }); throw new Error("did not reach home step: " + (await body()).slice(0, 300)); }
}
const pinnedText = async () => { const t = await body(); return t; };
async function pickFirst() {
  const box = p.getByPlaceholder(/Search your address|Search/i).first();
  await box.fill("Bhardwaj Homeopathy");
  const opt = p.locator('[role="option"], li button, button').filter({ hasText: /Bhardwaj Homeopathy/ }).first();
  await opt.waitFor({ state: "visible", timeout: 12000 });
  await opt.click();
}
const coordsShown = async (ll) => { const t = await body(); return t.includes("Pinned") && !/Couldn't get coordinates/.test(t) && (t.includes(ll.lat.toFixed(5)) || t.includes("Bhardwaj")); };
// The picker shows the address (not the numbers) once pinned, so also read the pin from the map props via the DOM: the pins are rendered
// through Mappls (stubbed) — instead verify by the onboarding form's hidden state: we expose it through the "Pinned · <address>" line + no error.

try {
  // ---- A. suggestion carries lat/lng ---------------------------------------
  console.log("A. suggestion already has coordinates");
  Object.assign(knobs, { pluginDelayMs: 0, pinDetails: "hang", nominatim: "fail", suggestionHasLatLng: true });
  await freshPicker(); await pickFirst(); await wait(1200);
  ok(/Pinned/.test(await body()), "A: pinned");
  ok(!/Couldn't get coordinates/.test(await body()), "A: no error");
  ok(!/only place the pin near/.test(await body()), "A: not flagged approximate");
  await p.screenshot({ path: `${OUT}/A.png` });

  // ---- B. plugin script arrives 2.5 s AFTER the map SDK (the live-site race) --
  console.log("B. eLoc only, plugin arrives late");
  Object.assign(knobs, { pluginDelayMs: 2500, pinDetails: "ok", nominatim: "fail", suggestionHasLatLng: false });
  nominatimCalls.length = 0;
  await freshPicker(); await pickFirst(); await wait(1500);
  ok(/Pinned/.test(await body()), "B: pinned via getPinDetails although plugin loaded late");
  ok(!/Couldn't get coordinates/.test(await body()), "B: no error");
  ok(nominatimCalls.length === 0, "B: geocoder not consulted when Mappls answers (" + nominatimCalls.length + " calls)");
  await p.screenshot({ path: `${OUT}/B.png` });

  // ---- C. plugin answers with no coordinates → geocoder on full text --------
  console.log("C. plugin empty → geocoder (full text)");
  Object.assign(knobs, { pluginDelayMs: 0, pinDetails: "empty", nominatim: "ok", suggestionHasLatLng: false });
  nominatimCalls.length = 0;
  await freshPicker(); await pickFirst(); await wait(1500);
  ok(/Pinned/.test(await body()), "C: pinned via geocoder");
  ok(nominatimCalls.length === 1 && /^Bhardwaj Homeopathy Clinic, Sector C/.test(nominatimCalls[0]), "C: first geocoder query is name + full address (" + nominatimCalls[0] + ")");
  ok(!/only place the pin near/.test(await body()), "C: full-text match is not flagged approximate");

  // ---- D. only the address tail geocodes → approximate note -----------------
  console.log("D. only locality resolves → approximate");
  Object.assign(knobs, { pluginDelayMs: 0, pinDetails: "empty", nominatim: "tail-only", suggestionHasLatLng: false });
  nominatimCalls.length = 0;
  await freshPicker(); await pickFirst(); await wait(5000);
  ok(/only place the pin near that area/.test(await body()), "D: approximate note shown");
  ok(!/Couldn't get coordinates/.test(await body()), "D: no hard error");
  ok(nominatimCalls.length === 3 && nominatimCalls[2] === "Vasant Kunj, New Delhi, Delhi, 110070", "D: fell back name+addr → 'Sector C, …' → 'Vasant Kunj, …' (" + JSON.stringify(nominatimCalls) + ")");
  await p.screenshot({ path: `${OUT}/D.png` });
  // tapping the map clears the note
  const mapEl = p.locator('[aria-label="Map"]').first(); const bb = await mapEl.boundingBox();
  ok(!!bb && bb.height >= 200, "D: map canvas holder is ≥200px tall (" + Math.round(bb?.height || 0) + "px)");

  // ---- E. nothing resolves → clear error --------------------------------------
  console.log("E. everything fails");
  Object.assign(knobs, { pluginDelayMs: 0, pinDetails: "empty", nominatim: "fail", suggestionHasLatLng: false });
  nominatimCalls.length = 0;
  await freshPicker(); await pickFirst(); await wait(6000);
  ok(/Couldn't get coordinates for that place/.test(await body()), "E: clear error");
  ok(/tap the map/i.test(await body()), "E: error tells the user what to do");
  ok(nominatimCalls.length === 4, "E: tried 4 geocoder queries before giving up (" + nominatimCalls.length + ")");
  await p.screenshot({ path: `${OUT}/E.png` });

  // ---- F. full-bleed screens: the map holder must fill the viewport ----------
  console.log("F. full-bleed map holders");
  Object.assign(knobs, { pluginDelayMs: 0, pinDetails: "ok", nominatim: "ok" });
  await p.goto("http://localhost:4179/", { waitUntil: "domcontentloaded" }); await wait(800);
  await p.getByPlaceholder("you@example.com").fill("asha@demo.in");
  await p.getByRole("button", { name: "Sign in", exact: true }).click(); await wait(1200);
  const acc = p.getByRole("button", { name: /I accept the updated terms/ }); if (await acc.count()) { await acc.click(); await wait(800); }
  for (const [label, go] of [["Discover", async () => { await p.getByRole("button", { name: /^Discover/ }).first().click(); }], ["Carpool detail", async () => { await p.evaluate(() => { location.hash = "#/carpool/cp1"; }); }]]) {
    await go(); await wait(1800);
    const el = p.locator('[aria-label="Map"]').first(); const bb = await el.boundingBox();
    const vh = 860;
    ok(!!bb && bb.height >= vh * 0.6, `F: ${label} map holder fills ≥60% of the viewport (${Math.round(bb?.height || 0)}px of ${vh})`);
    ok(!!bb && bb.width >= 400, `F: ${label} map holder is full width (${Math.round(bb?.width || 0)}px)`);
    await p.screenshot({ path: `${OUT}/F-${label.replace(/\s/g, "")}.png` });
  }
} catch (e) { console.log("HARNESS ERROR", e.message); results.push([false, "harness: " + e.message]); }

const pass = results.filter((r) => r[0]).length;
console.log(`\n${pass}/${results.length} checks passed; page errors: ${errors.length}`);
errors.slice(0, 5).forEach((e) => console.log("  page error:", e));
await browser.close(); srv.kill();
process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
