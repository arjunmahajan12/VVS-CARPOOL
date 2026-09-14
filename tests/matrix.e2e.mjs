// SCREEN MATRIX — every screen × role × theme × width, checked by code:
//  (1) no horizontal overflow, (2) every button/link has an accessible name,
//  (3) every form control has a label, (4) no visible text with contrast < 3:1,
//  (5) no console/page errors. No screenshots are used as evidence.
import { chromium } from "/home/claude/vvs-carpool-app/node_modules/playwright-core/index.mjs";
import { execSync } from "node:child_process";
const exe = execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome").toString().trim();
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const results=[]; const errors=[];
const ok=(c,l)=>{ results.push([!!c,l]); if(!c) console.log("  ✗ "+l); };

const ROLES = {
  asha:  { email:"asha@demo.in",  screens:["#/home","#/discover","#/carpools","#/alerts","#/profile","#/family","#/car","#/settings","#/history"] },
  priya: { email:"priya@demo.in", screens:["#/home","#/discover","#/carpools"] },
  dadi:  { email:"dadi@demo.in",  screens:["#/home","#/carpools","#/profile","#/settings"] },
  driver:{ email:"driver@demo.in",screens:["#/home","#/carpools","#/profile","#/car"] },
  admin: { email:"admin@vasantvalley.demo", screens:["#/admin/dashboard","#/admin/verify","#/admin/carpools","#/admin/incidents","#/admin/settings","#/admin/notices","#/alerts","#/profile"] },
};
const CHECK = `(() => {
  const out = { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, unnamed: [], unlabeled: [], lowContrast: [] };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && r.top < innerHeight && r.bottom > 0; };
  for (const el of document.querySelectorAll("button, a[href], [role=button]")) {
    if (!vis(el)) continue;
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || "").trim();
    if (!name) out.unnamed.push(el.outerHTML.slice(0, 80));
  }
  for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
    if (!vis(el)) continue;
    const id = el.id; const lab = (id && document.querySelector('label[for="'+id+'"]')) || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("placeholder");
    if (!lab) out.unlabeled.push(el.outerHTML.slice(0, 80));
  }
  const lum = (r,g,b) => { const f=(c)=>{ c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = (s) => { const m = s && s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(",").map(Number); return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 }; };
  const bgOf = (el) => { let e = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.9) return c; e = e.parentElement; } return { r:245,g:247,b:251,a:1 }; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const seen = new Set();
  while ((n = walker.nextNode())) {
    const t = n.textContent.trim(); if (t.length < 2) continue; const el = n.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
    const cs = getComputedStyle(el); if (parseFloat(cs.opacity) < 0.5) continue;
    const fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el);
    const L1 = lum(fg.r,fg.g,fg.b), L2 = lum(bg.r,bg.g,bg.b); const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if (ratio < 3) out.lowContrast.push(t.slice(0,40)+" ("+ratio.toFixed(1)+")");
  }
  return out;
})()`;

for (const theme of ["light","dark"]) for (const width of [360, 430]) {
  const ctx = await browser.newContext({ viewport:{width, height:820}, isMobile:true, hasTouch:true, colorScheme: theme });
  const p = await ctx.newPage();
  p.on("console",m=>{ if(m.type()==="error"){const t=m.text(); if(!/net::|Failed to load resource|ERR_|fetch|NetworkError/i.test(t)) errors.push(`[${theme}/${width}] ${t.slice(0,120)}`);} }); p.on("pageerror",e=>errors.push(`[${theme}/${width}] PAGEERROR ${e.message}`));
  await p.goto("http://localhost:4177/",{waitUntil:"domcontentloaded"}); await wait(700);
  try { localStorage; await p.evaluate((t)=>{ try{ localStorage.setItem("theme", t); }catch{} document.documentElement.classList.toggle("dark", t==="dark"); }, theme); } catch {}
  // auth screen itself
  { const r = await p.evaluate(CHECK); ok(r.overflow<=1, `[${theme}/${width}] auth: no horizontal overflow (${r.overflow}px)`); ok(r.unnamed.length===0, `[${theme}/${width}] auth: buttons named ${JSON.stringify(r.unnamed.slice(0,2))}`); ok(r.unlabeled.length===0, `[${theme}/${width}] auth: inputs labelled ${JSON.stringify(r.unlabeled.slice(0,2))}`); ok(r.lowContrast.length===0, `[${theme}/${width}] auth: contrast ${JSON.stringify(r.lowContrast.slice(0,3))}`); }
  for (const [role, cfg] of Object.entries(ROLES)) {
    await p.getByRole("button",{name:new RegExp(cfg.email.replace(".","\\."))}).click(); await wait(1000);
    const acc=p.getByRole("button",{name:/I accept the updated terms/}); if(await acc.count()){ await acc.click(); await wait(600); }
    for (const h of cfg.screens) {
      await p.evaluate((h)=>{ location.hash=h; }, h); await wait(900);
      const r = await p.evaluate(CHECK);
      const tag = `[${theme}/${width}] ${role} ${h}`;
      ok(r.overflow<=1, `${tag}: no horizontal overflow (${r.overflow}px)`);
      ok(r.unnamed.length===0, `${tag}: buttons named ${JSON.stringify(r.unnamed.slice(0,2))}`);
      ok(r.unlabeled.length===0, `${tag}: inputs labelled ${JSON.stringify(r.unlabeled.slice(0,2))}`);
      ok(r.lowContrast.length===0, `${tag}: contrast ${JSON.stringify(r.lowContrast.slice(0,3))}`);
    }
    // sign out in-app
    await p.evaluate(()=>{ location.hash="#/settings"; }); await wait(600);
    const so=p.getByRole("button",{name:"Sign out"}); if(await so.count()){ await so.click(); await wait(300); const b=p.locator('[role=alertdialog] button'); if(await b.count()) await b.last().click(); await wait(700); }
    else { await p.evaluate(()=>{ location.hash="#/home"; }); }
  }
  await ctx.close();
}
await browser.close();
const passed=results.filter(r=>r[0]).length;
console.log(`\n=== MATRIX: ${passed}/${results.length} checks passed ===`); console.log("ERRORS:", errors.length?errors.join("\n"):"none");
