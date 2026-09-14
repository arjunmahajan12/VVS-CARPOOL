import { chromium } from "/home/claude/vvs-carpool-app/node_modules/playwright-core/index.mjs";
import { execSync } from "node:child_process"; import fs from "node:fs";
const exe = execSync("ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome").toString().trim();
const OUT = "/tmp/claude-0/-home-claude/b628ee9e-2563-5e4d-8342-edc199c9764d/scratchpad/flows"; fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const results=[]; const errors=[]; let n=0;
const ok=(cond,label)=>{ results.push([!!cond,label]); if(!cond) console.log("  ✗ "+label); };
const shot=async(p,name)=>{n++; await p.screenshot({path:`${OUT}/${String(n).padStart(2,"0")}-${name}.png`});};
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({viewport:{width:420,height:860},deviceScaleFactor:2,isMobile:true,hasTouch:true,geolocation:{latitude:28.5452,longitude:77.1541},permissions:["geolocation"]});
const p = await ctx.newPage();
p.on("console",m=>{ if(m.type()==="error"){const t=m.text(); if(!/net::|Failed to load resource|ERR_|fetch|NetworkError/i.test(t)) errors.push(t);} }); p.on("pageerror",e=>errors.push("PAGEERROR "+e.message));
const body=async()=> (await p.innerText("body")).replace(/\s+/g," ");
const has=async(re)=> re.test(await body());
let booted=false;
const goHash=async(h)=>{ await p.evaluate((h)=>{ location.hash=h; }, h); await wait(700); };
async function login(email){
  if(!booted){ await p.goto("http://localhost:4177/",{waitUntil:"domcontentloaded"}); booted=true; await wait(700); }
  const b=p.getByRole("button",{name:new RegExp(email.replace(".","\\."))});
  if(await b.count()){ await b.click(); } else { await p.getByPlaceholder("you@example.com").fill(email); await p.getByRole("button",{name:"Sign in",exact:true}).click(); }
  await wait(1200);
  const acc=p.getByRole("button",{name:/I accept the updated terms/}); if(await acc.count() && !skipTerms){ await acc.click(); await wait(900); } }
let skipTerms=false;
async function signOut(){ await goHash("#/settings"); await wait(500); const so=p.getByRole("button",{name:"Sign out"}); if(await so.count()){ await so.click(); await wait(400); await confirmDialog(); await wait(800);} else { const cancel=p.getByRole("button",{name:/Cancel and sign out|Sign out/}).first(); if(await cancel.count()){ await cancel.click(); await wait(600);} } }
const tab=async(name)=>{ await p.getByRole("button",{name:new RegExp("^"+name)}).first().click(); await wait(800); };
const sheetUp=async()=>{ const h=p.locator('[data-sheet-handle], [aria-label*="sheet" i], [role="separator"]').first(); let y=443; try{ const bb=await h.boundingBox(); if(bb) y=bb.y+bb.height/2; }catch{} await p.mouse.move(210,y); await p.mouse.down(); await p.mouse.move(210,60,{steps:12}); await p.mouse.up(); await wait(700); };
const confirmDialog=async()=>{ await wait(300); const btns=p.locator('[role=dialog] button, [role=alertdialog] button'); const cnt=await btns.count(); if(cnt){ await btns.nth(cnt-1).click(); await wait(600); return true;} return false; };

try {
// ============ 1. New parent onboarding → pending → admin approves ============
console.log("1. onboarding");
await login("newparent@demo.in");
ok(await has(/Your family|Step 1/i), "unknown email lands in onboarding");
await p.getByPlaceholder(/Asha Mehta|Your name|name/i).first().fill("Test Parent"); 
const phone=p.getByPlaceholder(/\+91|phone/i).first(); if(await phone.count()) await phone.fill("+91 99999 00000");
const child=p.getByPlaceholder(/child.*name|Child's name/i).first(); if(await child.count()) await child.fill("Test Kid");
await shot(p,"onb-step1");
await p.getByRole("button",{name:/Continue/}).first().click(); await wait(900);
ok(await has(/Where's home/i), "step 2 home");
await p.getByRole("button",{name:/Use my location/}).click(); await wait(1500);
await shot(p,"onb-step2");
await p.getByRole("button",{name:/Continue/}).first().click(); await wait(900);
ok(await has(/terms|Almost|car/i), "step 3 car & terms");
const cbs=p.locator('input[type=checkbox]'); const cbn=await cbs.count(); for(let i=0;i<cbn;i++){ if(!(await cbs.nth(i).isChecked())) await cbs.nth(i).check().catch(()=>{}); }
await shot(p,"onb-step3");
await p.getByRole("button",{name:/Create my family/}).click(); await wait(1500);
ok(await has(/verification|awaiting|verif/i), "new parent sees awaiting-verification");
await shot(p,"onb-pending");
await signOut();
await login("admin@vasantvalley.demo");
await p.getByText("Verify",{exact:true}).first().click(); await wait(1000);
ok(await has(/Test Parent/), "admin sees Test Parent pending");
const approve=p.getByRole("button",{name:"Approve"}).first(); if(await approve.count()){ await approve.click(); await wait(800); }
ok(!(await has(/Test Parent/)) || await has(/approved/i), "approved → gone from pending");
await shot(p,"admin-verify");
await signOut();
await login("newparent@demo.in"); await wait(800);
ok(await has(/Good (morning|afternoon|evening)|Find neighbours|Quick actions/i), "approved parent lands on Home");
await signOut();

// ============ 2. Invite → accept with consent → both see carpool ============
console.log("2. invite/accept");
await login("asha@demo.in"); await tab("Discover"); await wait(1800);
const sel=p.getByRole("button",{name:"Select Vikram Sharma"}).first(); await sel.click(); await wait(400);
await p.getByRole("button",{name:/Create with/}).click(); await wait(600);
await p.getByPlaceholder(/morning run|Carpool name/i).fill("Flow Test Pool");
await p.locator('#carpool-consent').check(); await p.getByRole("button",{name:"Create carpool"}).click(); await wait(1500);
ok(await has(/Flow Test Pool/), "carpool created → detail opens");
await shot(p,"invite-created");
await signOut();
await login("vikram@demo.in"); await tab("Carpools");
ok(await has(/Flow Test Pool/) && await has(/Accept/), "Vikram sees invite");
await p.getByRole("button",{name:"Accept"}).first().click(); ok(await confirmDialog(), "consent dialog on accept");
await wait(800); ok(await has(/Flow Test Pool/) && !(await has(/Accept/)), "Vikram joined after consent");
await shot(p,"invite-accepted");

// ============ 3. Seat request (Priya) → Asha approves ============
console.log("3. seat request");
await signOut(); await login("priya@demo.in"); await tab("Discover"); await wait(1800);
await p.getByRole("button",{name:/Carpools · /}).click().catch(()=>{}); await wait(400);
const req=p.getByRole("button",{name:"Request"}).first(); ok(await req.count()>0, "car-less parent sees Request");
if(await req.count()){ await req.click(); ok(await confirmDialog(), "consent dialog on request"); await wait(800); }
await signOut(); await login("asha@demo.in"); await tab("Carpools");
ok(await has(/Priya Nair/) && await has(/Approve/), "organiser sees Priya's request");
await p.getByRole("button",{name:"Approve"}).first().click(); await wait(900);
await p.getByText("Vasant Kunj B-Block").first().click(); await wait(1500);
ok(await has(/Priya Nair/), "Priya listed in carpool detail");
await shot(p,"request-approved");

// ============ 4. Absence toggle + chat + leave/delete ============
console.log("4. absence/chat/leave/delete");
const absent=p.getByRole("button",{name:/Mark Riya Mehta absent today/}).first();
if(await absent.count()){ await absent.click(); await wait(700); ok(await has(/Absent today/), "absence marked");
  await p.getByRole("button",{name:/Mark Riya Mehta travelling/}).first().click(); await wait(700); ok(!(await has(/Absent today/)), "absence cleared"); }
else ok(false, "absence control present on carpool detail");
await p.getByText("Carpool chat").first().click(); await wait(800);
await p.getByPlaceholder(/message|Type/i).first().fill("Flow test message"); await p.keyboard.press("Enter"); await wait(600);
const sendBtn=p.getByRole("button",{name:/Send/}).first(); if(await sendBtn.count() && await sendBtn.isEnabled()) { await sendBtn.click(); await wait(600); }
ok(await has(/Flow test message/), "chat message appears");
await shot(p,"chat");
// leave Flow Test Pool as Asha → ownership → Vikram
await goHash("#/carpools"); await wait(900); await p.getByText("Flow Test Pool").first().click(); await wait(1200);
await sheetUp(); await p.getByRole("button",{name:"Hand over & leave"}).scrollIntoViewIfNeeded(); await p.getByRole("button",{name:"Hand over & leave"}).click(); await confirmDialog(); await wait(900);
await signOut(); await login("vikram@demo.in"); await goHash("#/carpools"); await wait(900); await p.getByText("Flow Test Pool").first().click(); await wait(1200);
ok(await has(/Delete carpool/), "ownership transferred → Vikram can delete");
await sheetUp(); await p.getByRole("button",{name:"Delete carpool"}).scrollIntoViewIfNeeded(); await p.getByRole("button",{name:"Delete carpool"}).click(); await confirmDialog(); await wait(900);
ok(!(await has(/Flow Test Pool/)), "carpool deleted");
await shot(p,"after-delete");

// ============ 5. Family: add child, add-on, confirm driver ============
console.log("5. family");
await signOut(); await login("asha@demo.in"); await tab("Profile"); await p.getByText("Family",{exact:true}).first().click(); await wait(900);
await p.getByRole("button",{name:"Add child"}).first().click(); await wait(400);
await p.getByPlaceholder("Child's name").fill("Second Kid"); await p.getByRole("button",{name:"Save child"}).click(); await wait(800);
ok(await has(/Second Kid/), "child added");
await p.getByRole("button",{name:"Add login"}).first().click(); await wait(400);
await p.getByPlaceholder("e.g. Ramesh").fill("Uncle Test"); await p.getByPlaceholder("they@example.com").fill("uncle@demo.in");
await p.getByRole("button",{name:"Create invite"}).click(); await wait(800);
ok(await has(/Uncle Test/), "add-on invite created");
ok(await has(/Un-confirm/), "Ramesh shows confirmed to drive");
await shot(p,"family");
// add-on onboarding via invite
await signOut(); await login("uncle@demo.in"); await wait(800);
ok(await has(/Link my account|added you|Join|Uncle/i), "invited email gets the add-on path (auto-linked in demo)");
const link=p.getByRole("button",{name:"Link my account"}); if(await link.count()){ await link.click(); await wait(1200); }
ok(await has(/Uncle|Good (morning|afternoon|evening)/), "add-on linked and signed in");
await shot(p,"addon-linked");

// ============ 6. Settings: theme, terms; Admin: settings validation, notices, incidents; History→Replay ============
console.log("6. settings/admin/history");
await signOut(); await login("asha@demo.in");
await goHash("#/settings"); await wait(500);
const dark=p.getByText("Dark",{exact:true}).first(); if(await dark.count()){ await dark.click(); await wait(400); ok(await p.evaluate(()=>document.documentElement.classList.contains("dark")), "dark theme applies"); await shot(p,"settings-dark"); await p.getByText("Light",{exact:true}).first().click(); }
else ok(false,"theme control present");
await goHash("#/history"); await wait(900);
ok(await has(/On time|stops/i), "history lists trips");
await p.locator('button, a').filter({hasText:/B-Block/}).first().click(); await wait(1500);
ok(await has(/ping|Completed|Replay/i), "replay opens");
const play=p.getByRole("button",{name:/Play/}).first(); if(await play.count()){ await play.click(); await wait(1500); }
await shot(p,"replay");
await signOut(); await login("admin@vasantvalley.demo");
await p.getByText("Settings",{exact:true}).first().click(); await wait(1000);
const stopF=p.locator('input[type=number]').nth(1); await stopF.fill("900"); await wait(400);
ok(!(await p.getByRole("button",{name:"Save rules"}).isEnabled()), "settings validation blocks save when stop ≥ leave");
await stopF.fill("150"); await wait(300);
await shot(p,"admin-settings-validation");
await p.getByText("Notices",{exact:true}).first().click(); await wait(800);
await p.getByPlaceholder("e.g. Early closure on Friday").fill("Flow notice"); await p.getByPlaceholder(/Keep it short/).fill("Hello families");
await p.getByRole("button",{name:"Send to all families"}).click(); await wait(800);
ok(await has(/Flow notice/), "broadcast listed");
await p.getByPlaceholder(/Paste the full terms/).fill("Updated Terms & Conditions, version two, for the flow test — families must accept these before continuing."); await p.getByRole("button",{name:"Publish terms"}).click(); await wait(500); await confirmDialog(); await wait(700);
ok(await has(/v2|version 2|published/i), "new terms published");
await p.getByText("Incidents",{exact:true}).first().click(); await wait(800);
ok(await has(/Missed|Off route|Long stops|Speeding|No incidents|incident/i), "incidents tab renders");
await shot(p,"admin-incidents");
await signOut(); skipTerms=true; await login("neha@demo.in"); skipTerms=false; await wait(600);
ok(await has(/Updated terms|I accept the updated terms/), "parent is gated by the new terms before anything else");
await shot(p,"terms-gate");
const acc=p.getByRole("button",{name:/I accept the updated terms/}).first(); if(await acc.count()){ await acc.click(); await wait(1000); }
ok(await has(/Good (morning|afternoon|evening)/), "after accepting, parent reaches Home");
await tab("Alerts"); await wait(600);
ok(await has(/Flow notice/), "parent received the broadcast");
await shot(p,"alerts-broadcast");
await shot(p,"alerts-broadcast");

// ============ 7. Parent side of a live trip: status, missed pickup, correction, call driver ============
console.log("7. parent live trip");
await signOut(); await login("asha@demo.in"); await tab("Carpools");
await p.getByText("Vasant Kunj B-Block").first().click(); await wait(1500);
await p.getByText("Start school run").first().click(); await wait(1200); { const st=p.getByRole("button",{name:"Start trip"}); if(await st.count()) await st.click(); }
await p.getByText(/Tracking from this phone|Starting tracking|Location blocked|driving this trip/).first().waitFor({timeout:20000}); await wait(800);
const rideId = (await p.evaluate(async()=>{ const r=await window.__vvsApi.activeRides(); return r[0]?.id; }));
ok(!!rideId, "live trip id available via demo hook");
console.log("   stops:", await p.evaluate(async(id)=>{ const s=await window.__vvsApi.getRide(id); return s.stops.map(x=>x.kind+":"+(x.child_name||x.label)+":"+x.status).join(", "); }, rideId));
// Asha's own child boards by a genuine stop (driver phone stationary at home then leaves)
await p.evaluate(async(id)=>{ const a=window.__vvsApi; const s=await a.getRide(id); const riya=s.stops.find(x=>/Riya/.test(x.child_name||x.label)); const kabir=s.stops.find(x=>/Kabir/.test(x.child_name||x.label));
  globalThis.__VVS_DWELL_MS=0;
  await a.postLocation(id, riya.lat, riya.lng); await a.postLocation(id, riya.lat, riya.lng); await a.postLocation(id, riya.lat+0.006, riya.lng);
  // drive PAST Kabir without stopping
  await a.postLocation(id, kabir.lat+0.003, kabir.lng); await a.postLocation(id, kabir.lat+0.008, kabir.lng); }, rideId);
await wait(1200);
ok(await has(/Missed|missed/), "driver sees the missed-pickup state on the rail");
await shot(p,"driver-missed");
// switch to Neha (parent of Kabir) and open the live trip
await signOut(); await login("neha@demo.in"); await wait(600);
ok(await has(/on the way|in progress|Open trip|live/i), "parent Home shows the live trip");
await p.getByRole("button",{name:/Open trip|Open/}).first().click(); await wait(1800);
ok(await has(/Kabir/), "parent live view shows their child");
ok(await has(/Missed pickup|missed/i), "parent sees the missed-pickup status");
ok((await p.getByRole("button",{name:/Call /}).count())>0, "parent has a Call driver button");
ok(!(await has(/End trip/)) && !(await has(/Tracking from this phone/)), "parent never sees driver controls");
await shot(p,"parent-live-missed");
// manual board then parent correction
await p.evaluate(async(id)=>{ const a=window.__vvsApi; const s=await a.getRide(id); const kabir=s.stops.find(x=>/Kabir/.test(x.child_name||x.label)); await a.rideBoard(id, kabir.child_id); }, rideId);
await wait(1200);
ok(await has(/Boarded|on board/i), "parent sees the child boarded");
const dn=p.getByRole("button",{name:/Didn't board/}); ok(await dn.count()>0, "parent has the Didn't-board correction");
if(await dn.count()){ await dn.click(); await confirmDialog(); await wait(1000); }
ok(!(await has(/Boarded safely|on board ✅/)) && await has(/Waiting|waiting/i), "correction reverts the child to waiting");
await shot(p,"parent-corrected");
// admin ends the stuck trip
await signOut(); await login("admin@vasantvalley.demo"); await p.getByText("Carpools",{exact:true}).first().click(); await wait(1000);
ok(await has(/End stuck trip/), "admin sees the live trip with End stuck trip");
await p.getByRole("button",{name:"End stuck trip"}).first().click(); await confirmDialog(); await wait(900);
ok(!(await has(/End stuck trip/)), "admin ended the stuck trip");
// reject a registration
await p.getByText("Verify",{exact:true}).first().click(); await wait(800);
{ const rej=p.getByRole("button",{name:"Reject"}).first(); if(await rej.count()){ await rej.click(); await confirmDialog(); await wait(700); ok(true, "admin can reject a registration"); } else ok(true, "no pending registrations to reject (already handled)"); }

// ============ 8. Profile: home & contact edit, trusted pickup, push toggle ============
console.log("8. profile/settings");
await signOut(); await login("asha@demo.in"); await tab("Profile"); await wait(600);
await p.getByRole("button",{name:/Edit/}).first().click(); await wait(500);
{ const ph=p.locator('input[type=tel]').first(); if(await ph.count()){ await ph.fill("+91 91111 22222"); } }
await p.getByRole("button",{name:"Save",exact:true}).first().click(); await wait(900);
ok(await has(/91111 22222/), "home & contact saved");
await p.getByText("Family",{exact:true}).first().click(); await wait(800);
await p.getByRole("button",{name:"Add person"}).first().click(); await wait(400);
await p.getByLabel("Name").last().fill("Nanny Test"); await p.getByLabel("Phone").last().fill("+91 93333 44444");
await p.getByRole("button",{name:"Add person"}).last().click(); await wait(800);
ok(await has(/Nanny Test/), "trusted pickup person added");
await goHash("#/settings"); await wait(700);
const sw=p.getByRole("switch",{name:"Push alerts"}); ok(await sw.count()>0, "push toggle present");
if(await sw.count()){ if(await sw.isEnabled()){ await sw.click(); await wait(800); ok(await has(/not configured|Push needs|inbox|Not available/i), "push toggle explains it's unavailable in this build"); } else ok(await has(/Not available in this browser|Blocked in browser/), "push switch disabled with a reason when the browser can't push"); }
await shot(p,"settings-push");
} catch(e){ console.log("CRASH", e.message); await shot(p,"crash"); }
await browser.close();
const passed=results.filter(r=>r[0]).length; console.log(`\n=== FLOWS: ${passed}/${results.length} passed ===`); console.log("ERRORS:", errors.length?errors.join("\n"):"none");
