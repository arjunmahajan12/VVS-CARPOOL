// Settings — theme, push alerts on this device, terms (with accept when a
// new version is out), and sign out.
import { useEffect, useState } from "react";
import { BellRing, FileText, LogOut, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import { useAuth } from "../context/auth";
import { api, MODE } from "../lib/api";
import { nav } from "../lib/nav";
import { getTheme, onThemeChange, setTheme, type ThemePref } from "../lib/theme";
import { isPushSubscribed, pushPermission, pushSupport, subscribePush, unsubscribePush } from "../lib/push";
import { Button, Card, Pill, SectionTitle, SegmentedControl, TopBar, useConfirm, useToast, cn } from "../components/ui";

export default function Settings() {
  const { user, signOut, refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const u = user!;
  const [theme, setThemeState] = useState<ThemePref>(getTheme());
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [tnc, setTnc] = useState<{ version: number; body: string } | null | undefined>(undefined);
  const [showTnc, setShowTnc] = useState(false);
  const [tncBusy, setTncBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const support = pushSupport();
  const perm = pushPermission();

  useEffect(() => onThemeChange((_r, pref) => setThemeState(pref)), []);
  useEffect(() => { void isPushSubscribed().then(setPushOn); }, []);
  useEffect(() => {
    let alive = true;
    api.latestTnc().then((t) => { if (alive) setTnc(t); }).catch(() => { if (alive) setTnc(null); });
    return () => { alive = false; };
  }, []);

  async function togglePush() {
    setPushBusy(true);
    if (pushOn) {
      const ok = await unsubscribePush(api);
      if (ok) { setPushOn(false); toast("Push alerts are off on this device."); }
      else toast.warn("Couldn't turn push off — try again.");
    } else {
      const r = await subscribePush(api);
      if (r.ok) { setPushOn(true); toast.ok("Push alerts are on for this device."); }
      else if (r.reason === "no-key") toast.info(MODE === "demo" ? "Push needs the live build with a VAPID key — the in-app inbox still works in demo." : "Push isn't configured for this school yet — you'll still get alerts in the app.");
      else if (r.reason === "denied") toast.warn("Notifications are blocked for this site in your browser settings.");
      else if (r.reason === "unsupported" || r.reason === "insecure") toast.info("This browser can't do push. Add the app to your home screen or use Chrome.");
      else toast.warn("Couldn't turn on push right now.");
    }
    setPushBusy(false);
  }

  async function acceptTerms() {
    setTncBusy(true);
    try { await api.acceptTnc(); await refresh(); toast.ok("Thanks — terms accepted."); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't record that."); }
    finally { setTncBusy(false); }
  }

  async function doSignOut() {
    if (!(await confirm({ title: "Sign out?", message: "You'll stop receiving in-app alerts on this device until you sign in again.", confirmLabel: "Sign out", danger: false, icon: LogOut }))) return;
    setSigningOut(true);
    await signOut();
    nav.reset();
  }

  const needsAccept = !!u.needs_tnc || (tnc ? tnc.version > (u.tnc_version ?? 0) : false);
  const pushLabel = support !== "supported" ? "Not available in this browser" : perm === "denied" ? "Blocked in browser settings" : pushOn == null ? "Checking…" : pushOn ? "On for this device" : "Off";

  return (
    <div className="anim-rise">
      <TopBar title="Settings" onBack={() => nav.back()} />
      <div className="grid gap-5 px-4 pb-8 pt-4 *:min-w-0">
        <section>
          <SectionTitle>Appearance</SectionTitle>
          <Card padding="md" className="mt-2">
            <SegmentedControl<ThemePref>
              full label="Theme"
              options={[{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "Auto", icon: Monitor }]}
              value={theme} onChange={(v) => { setTheme(v); setThemeState(v); }}
            />
            <p className="mt-2 text-xs text-ink-500">Auto follows your phone's light / dark setting.</p>
          </Card>
        </section>

        <section>
          <SectionTitle>Alerts</SectionTitle>
          <Card padding="md" className="mt-2 flex items-center gap-3">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", pushOn ? "bg-ok-soft text-ok-ink" : "bg-ink-100 text-ink-500")}><BellRing size={20} strokeWidth={2.25} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-ink-900">Push alerts on this device</p>
              <p className="text-sm text-ink-500">{pushLabel}</p>
            </div>
            <button
              type="button" role="switch" aria-checked={!!pushOn} aria-label="Push alerts"
              disabled={pushBusy || support !== "supported" || perm === "denied" || pushOn == null}
              onClick={() => void togglePush()}
              className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50", pushOn ? "bg-primary" : "bg-ink-300")}
            >
              <span className={cn("absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow-card transition-transform", pushOn ? "translate-x-5.5" : "translate-x-0.5")} />
            </button>
          </Card>
          <p className="mt-2 px-1 text-xs text-ink-500">Arriving, boarded, missed-pickup and trip-started alerts. The in-app inbox always works, push or not.</p>
        </section>

        <section>
          <SectionTitle action={tnc ? <Pill size="sm" tone={needsAccept ? "warn" : "ok"}>{needsAccept ? `v${tnc.version} to accept` : `v${u.tnc_version} accepted`}</Pill> : undefined}>Terms & privacy</SectionTitle>
          <Card padding="md" className="mt-2">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><FileText size={20} strokeWidth={2.25} aria-hidden /></span>
              <div className="min-w-0 flex-1 text-sm text-ink-700">
                <p className="text-base font-semibold text-ink-900">How your data is used</p>
                <p className="mt-0.5 text-pretty">Your approximate home pin is shared only with school-verified families. Live location is shared only during a trip, only with that carpool.</p>
                {tnc === undefined ? null : tnc === null ? (
                  <p className="mt-2 text-xs text-ink-500">The school hasn't published terms yet.</p>
                ) : (
                  <>
                    <button type="button" className="mt-2 text-sm font-semibold text-primary" onClick={() => setShowTnc((v) => !v)}>{showTnc ? "Hide" : "Read"} terms v{tnc.version}</button>
                    {showTnc && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-sm bg-card-2 p-3 font-sans text-xs text-ink-700">{tnc.body}</pre>}
                    {needsAccept && <Button className="mt-3" size="sm" icon={ShieldCheck} loading={tncBusy} onClick={acceptTerms}>Accept v{tnc.version}</Button>}
                  </>
                )}
              </div>
            </div>
          </Card>
        </section>

        <section>
          <Card padding="md" className="grid gap-3">
            <div className="text-sm text-ink-500">Signed in as <b className="text-ink-900">{u.email}</b></div>
            <Button variant="ghost" full icon={LogOut} loading={signingOut} onClick={() => void doSignOut()}>Sign out</Button>
          </Card>
          <p className="mt-3 text-center text-xs text-ink-500">VVS Carpool v8 · {MODE === "demo" ? "demo build" : "live"}</p>
        </section>
      </div>
    </div>
  );
}
