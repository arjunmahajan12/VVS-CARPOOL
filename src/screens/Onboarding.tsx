// Onboarding — three steps for a new family (who you are · where home is ·
// car & terms). An email that matches a family add-on invite takes the short
// path: link the login, done.
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Car, CheckCircle2, FileText, MapPin, UserRound, Users } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { Button, Card, Input, Logo, Select, Skeleton, useToast, cn } from "../components/ui";
import { LocationPicker, type PickedLocation } from "../components/map";

type Invite = { name: string; relation: string; parent_name: string };
const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Class ${i + 1}` }));
const GENDER_OPTIONS = [{ value: "female", label: "Girl" }, { value: "male", label: "Boy" }, { value: "other", label: "Prefer not to say" }];
const STEPS = [
  { title: "Your family", icon: Users },
  { title: "Where's home?", icon: MapPin },
  { title: "Car & terms", icon: Car },
];

export default function Onboarding() {
  const { register, email, signOut } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined); // undefined = checking
  const [busy, setBusy] = useState(false);
  const [home, setHome] = useState<PickedLocation | null>(null);
  const [tnc, setTnc] = useState<{ version: number; body: string } | null>(null);
  const [showTnc, setShowTnc] = useState(false);
  const [f, setF] = useState({
    name: "", phone: "", address: "", colony: "", pincode: "",
    child_name: "", child_class: "1", child_gender: "",
    can_drive: true, existing_carpool: false, accept_tnc: false,
  });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    let alive = true;
    api.pendingInvite().then((inv) => { if (alive) setInvite(inv); }).catch(() => { if (alive) setInvite(null); });
    api.latestTnc().then((t) => { if (alive) setTnc(t); }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, []);

  function onLoc(l: PickedLocation) {
    setHome(l);
    setF((s) => ({ ...s, address: l.address ?? s.address, colony: l.colony ?? s.colony, pincode: l.pincode ?? s.pincode }));
    setErr((e) => ({ ...e, home: "" }));
  }

  function validateStep0(): boolean {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "We need your name for the carpool roster.";
    if (f.phone && !/^[+\d][\d\s-]{7,}$/.test(f.phone.trim())) e.phone = "That doesn't look like a phone number.";
    if (!f.child_name.trim()) e.child_name = "Add at least one child — you can add more later.";
    setErr(e);
    return !Object.keys(e).length;
  }
  function next() {
    if (step === 0 && !validateStep0()) return;
    if (step === 1 && !home) { setErr({ home: "Drop a pin on your home so we can plan the pickup route." }); return; }
    setStep((s) => Math.min(2, s + 1));
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    if (!f.accept_tnc) { setErr({ tnc: "Please accept the terms to continue." }); return; }
    if (!home) { setStep(1); return; }
    setBusy(true);
    try {
      await register({
        name: f.name.trim(), phone: f.phone.trim() || undefined, address: f.address.trim() || undefined,
        colony: f.colony.trim() || undefined, pincode: f.pincode.trim() || undefined,
        child_name: f.child_name.trim(), child_class: Number(f.child_class), child_gender: f.child_gender || undefined,
        home_lat: home.lat, home_lng: home.lng, can_drive: f.can_drive, existing_carpool: f.existing_carpool, accept_tnc: true,
      });
      toast.ok("Welcome! The school will verify your family shortly.");
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : "Registration didn't go through — please try again.");
    } finally { setBusy(false); }
  }

  async function linkInvite() {
    if (!invite) return;
    setBusy(true);
    try {
      await register({ name: invite.name, relation: invite.relation, accept_tnc: true });
      toast.ok(`You're linked to ${invite.parent_name}'s family.`);
    } catch (e) {
      toast.danger(e instanceof Error ? e.message : "Couldn't link your account.");
    } finally { setBusy(false); }
  }

  // --- checking for an invite ---------------------------------------------
  if (invite === undefined) {
    return (
      <div className="px-5 pt-16">
        <Skeleton variant="text" lines={2} className="max-w-[240px]" />
        <Skeleton variant="card" className="mt-6" />
      </div>
    );
  }

  // --- add-on short path ---------------------------------------------------
  if (invite) {
    return (
      <div className="flex min-h-dvh flex-col justify-center px-5 pb-10 pt-safe">
        <span className="grid h-14 w-14 place-items-center rounded-lg bg-ok-soft text-ok-ink"><UserRound size={26} strokeWidth={2.25} aria-hidden /></span>
        <h1 className="mt-5 text-2xl">Join {invite.parent_name}'s family</h1>
        <p className="mt-2 text-base text-ink-500 text-pretty">
          {invite.parent_name} added <b className="text-ink-900">{invite.name}</b> as their {invite.relation || "family add-on"}.
          Link this login ({email}) and you'll see the family's trips and alerts right away.
        </p>
        <Card variant="inset" padding="sm" className="mt-5 text-sm text-ink-700">
          {invite.relation === "driver"
            ? "As the family driver you can share live GPS on trips once the family confirms you."
            : "Add-ons can follow trips and alerts. Only the parent can change children or carpools."}
        </Card>
        <Button size="lg" full className="mt-6" loading={busy} onClick={linkInvite}>Link my account</Button>
        <Button variant="ghost" full className="mt-2" onClick={() => void signOut()}>Not you? Sign out</Button>
      </div>
    );
  }

  // --- parent flow ----------------------------------------------------------
  const StepIcon = STEPS[step].icon;
  return (
    <div className="min-h-dvh px-5 pb-10 pt-safe">
      <header className="flex items-center gap-3 pt-8">
        <Logo size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">Step {step + 1} of 3</p>
          <p className="truncate text-sm text-ink-700">{email}</p>
        </div>
      </header>
      <ol className="m-0 mt-5 flex list-none gap-1.5 p-0" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s.title} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-ink-200")} aria-current={i === step ? "step" : undefined} />)}
      </ol>

      <div className="mt-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><StepIcon size={22} strokeWidth={2.25} aria-hidden /></span>
        <h1 className="text-2xl">{STEPS[step].title}</h1>
      </div>

      {step === 0 && (
        <div className="anim-rise mt-5 grid gap-4 *:min-w-0">
          <p className="text-base text-ink-500 -mt-1">Who's registering, and who rides.</p>
          <Input label="Your name" placeholder="e.g. Asha Mehta" autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} error={err.name} />
          <Input label="Phone" labelRight={<span className="text-xs text-ink-500">Shared with your carpool only</span>} type="tel" inputMode="tel" placeholder="+91 98xxx xxxxx" autoComplete="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} error={err.phone} />
          <Card padding="md">
            <p className="text-sm font-semibold text-ink-700">Your child</p>
            <div className="mt-3 grid gap-3">
              <Input label="Name" placeholder="Child's name" value={f.child_name} onChange={(e) => set("child_name", e.target.value)} error={err.child_name} />
              <div className="grid grid-cols-2 gap-3">
                <Select label="Class" options={CLASS_OPTIONS} value={f.child_class} onChange={(e) => set("child_class", e.target.value)} />
                <Select label="Gender" placeholder="Optional" options={GENDER_OPTIONS} value={f.child_gender} onChange={(e) => set("child_gender", e.target.value)} />
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-500">More children? Add them from Profile → Family after you're in.</p>
          </Card>
          <Button size="lg" full iconRight={ArrowRight} onClick={next}>Continue</Button>
        </div>
      )}

      {step === 1 && (
        <div className="anim-rise mt-5 grid gap-4 *:min-w-0">
          <p className="text-base text-ink-500 -mt-1 text-pretty">Used to match you with nearby families and to plan the pickup route. Only an approximate pin is shared with verified members.</p>
          <div>
            <LocationPicker value={home} onChange={onLoc} pinLabel="Home" />
            {err.home && <p className="mt-2 text-sm font-medium text-danger-ink">{err.home}</p>}
            {home && <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ok-ink"><CheckCircle2 size={15} aria-hidden /> Pin set{home.address ? ` · ${home.address}` : ""}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Colony / area" placeholder="e.g. Vasant Kunj" value={f.colony} onChange={(e) => set("colony", e.target.value)} />
            <Input label="Pin code" inputMode="numeric" placeholder="110070" maxLength={6} value={f.pincode} onChange={(e) => set("pincode", e.target.value.replace(/\D/g, ""))} />
          </div>
          <Input label="Address line" placeholder="House / block (optional)" value={f.address} onChange={(e) => set("address", e.target.value)} />
          <div className="flex gap-2">
            <Button variant="ghost" size="lg" icon={ArrowLeft} aria-label="Back" onClick={() => setStep(0)} />
            <Button size="lg" full iconRight={ArrowRight} onClick={next}>Continue</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="anim-rise mt-5 grid gap-4 *:min-w-0">
          <p className="text-base text-ink-500 -mt-1">Last bit — how your family takes part.</p>
          <Card padding="md" className="grid gap-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={f.can_drive} onChange={(e) => set("can_drive", e.target.checked)} />
              <span>
                <span className="block text-base font-semibold text-ink-900">We have a car and can drive trips</span>
                <span className="block text-sm text-ink-500">Only families with a car can organise a carpool. Without one, you can still join a neighbour's.</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={f.existing_carpool} onChange={(e) => set("existing_carpool", e.target.checked)} />
              <span>
                <span className="block text-base font-semibold text-ink-900">We're already in an offline carpool</span>
                <span className="block text-sm text-ink-500">Shown to neighbours so they know you may not be looking.</span>
              </span>
            </label>
          </Card>
          <Card variant="inset" padding="md">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-primary" checked={f.accept_tnc} onChange={(e) => { set("accept_tnc", e.target.checked); setErr({}); }} />
              <span className="text-sm text-ink-700">
                I agree to share my approximate home location with school-verified families to arrange carpools, and to use the app safely.
                {tnc && (
                  <> <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary" onClick={() => setShowTnc((v) => !v)}><FileText size={13} aria-hidden /> {showTnc ? "Hide" : "Read"} terms v{tnc.version}</button></>
                )}
              </span>
            </label>
            {showTnc && tnc && <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-sm bg-card p-3 text-xs text-ink-700 font-sans">{tnc.body}</pre>}
            {err.tnc && <p className="mt-2 text-sm font-medium text-danger-ink">{err.tnc}</p>}
          </Card>
          <div className="flex gap-2">
            <Button variant="ghost" size="lg" icon={ArrowLeft} aria-label="Back" onClick={() => setStep(1)} />
            <Button size="lg" full loading={busy} onClick={finish}>Create my family</Button>
          </div>
        </div>
      )}

      <button type="button" className="mt-8 w-full text-center text-xs text-ink-500 hover:text-ink-700" onClick={() => void signOut()}>Cancel and sign out</button>
    </div>
  );
}
