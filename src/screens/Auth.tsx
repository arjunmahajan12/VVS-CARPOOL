// Auth — sign in / create account. A set of one-tap demo logins covers every
// role so reviewers can tour the app without typing — always in demo mode, and
// on a live site once seed_demo.sql has been run (settings.demo_logins).
import { useEffect, useState, type FormEvent } from "react";
import { Car, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import { useAuth } from "../context/auth";
import { api, MODE } from "../lib/api";
import { DEMO_PASSWORD } from "../lib/demoAccounts";
import { Button, Card, Divider, Input, Logo, SegmentedControl, useToast, cn } from "../components/ui";

type Mode = "signin" | "signup";

interface Quick { email: string; name: string; sub: string }
const QUICK: { group: string; icon: typeof UserRound; tone: string; items: Quick[] }[] = [
  {
    group: "Parents", icon: Users, tone: "bg-primary-soft text-primary-soft-ink",
    items: [
      { email: "asha@demo.in", name: "Asha Mehta", sub: "Organiser · drives the carpool" },
      { email: "vikram@demo.in", name: "Vikram Sharma", sub: "Member · has a car" },
      { email: "neha@demo.in", name: "Neha Gupta", sub: "Member" },
      { email: "priya@demo.in", name: "Priya Nair", sub: "No car · join-only" },
      { email: "rohan@demo.in", name: "Rohan Kapoor", sub: "Awaiting verification" },
    ],
  },
  { group: "School admin", icon: ShieldCheck, tone: "bg-accent-soft text-accent-soft-ink", items: [{ email: "admin@vasantvalley.demo", name: "VVS School Admin", sub: "Verify, incidents, settings" }] },
  { group: "Family driver", icon: Car, tone: "bg-ok-soft text-ok-ink", items: [{ email: "driver@demo.in", name: "Ramesh Kumar", sub: "Drives for the Mehta family" }] },
  { group: "Add-on", icon: UserRound, tone: "bg-info-soft text-info-ink", items: [{ email: "dadi@demo.in", name: "Dadi", sub: "Grandparent · view-only" }] },
];

export default function Auth() {
  const { signIn, signUp } = useAuth();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("signin");
  const [demoLogins, setDemoLogins] = useState(MODE === "demo");
  useEffect(() => { if (MODE === "live") api.publicConfig().then((c) => setDemoLogins(!!c.demo_logins)).catch(() => {}); }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // email being signed in
  const [err, setErr] = useState<{ email?: string; password?: string }>({});

  async function go(em: string, pw: string, m: Mode) {
    setBusy(em);
    try {
      const res = await (m === "signup" ? signUp(em, pw) : signIn(em, pw));
      if (res.status === "pending") toast.info("Signed in — the school is still verifying your family.");
      else if (res.status === "rejected") toast.warn("Signed in — your registration needs attention.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't sign you in";
      toast.danger(msg);
    } finally { setBusy(null); }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof err = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter the email the school has on file.";
    if (MODE === "live" && password.length < 6) next.password = "At least 6 characters.";
    setErr(next);
    if (Object.keys(next).length) return;
    void go(email, password, mode);
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 pb-10 pt-safe">
      <header className="flex items-center gap-3 pt-10">
        <Logo size={72} />
        <div>
          <p className="font-display text-xs font-bold uppercase tracking-[0.14em] text-ink-500">Vasant Valley School</p>
          <h1 className="text-xl leading-7">VVS Carpool</h1>
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-2xl">{mode === "signin" ? "Welcome back" : "Create your family account"}</h2>
        <p className="mt-1.5 text-base text-ink-500 text-pretty">
          {mode === "signin"
            ? "Sign in to see today's trip, your carpools and alerts."
            : "Use the email the school has on file. We'll verify your family before matching you with neighbours."}
        </p>
      </section>

      <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
        <SegmentedControl<Mode>
          full label="Sign in or create account"
          options={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Create account" }]}
          value={mode} onChange={(v) => { setMode(v); setErr({}); }}
        />
        <Input
          label="Email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
          leftIcon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} error={err.email}
        />
        <Input
          label="Password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"}
          placeholder={MODE === "demo" ? "Any password works in demo" : "••••••••"}
          leftIcon={LockKeyhole} value={password} onChange={(e) => setPassword(e.target.value)} error={err.password}
        />
        <Button type="submit" size="lg" full loading={busy === email && !!email} disabled={!!busy}>
          {mode === "signin" ? "Sign in" : "Continue"}
        </Button>
        <p className="text-center text-xs text-ink-500">
          {mode === "signin" ? "New to the carpool? " : "Already registered? "}
          <button type="button" className="font-semibold text-primary" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </form>

      {demoLogins && (
        <section className="mt-2">
          <Divider label={<span className="inline-flex items-center gap-1.5"><Sparkles size={13} aria-hidden /> Demo quick login</span>} />
          <div className="grid gap-3 *:min-w-0">
            {QUICK.map((g) => {
              const Icon = g.icon;
              return (
                <Card key={g.group} padding="sm" className="min-w-0">
                  <div className="flex items-center gap-2 px-1 pb-1 pt-0.5">
                    <span className={cn("grid h-7 w-7 place-items-center rounded-sm", g.tone)}><Icon size={15} strokeWidth={2.25} aria-hidden /></span>
                    <span className="text-sm font-semibold text-ink-700">{g.group}</span>
                  </div>
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {g.items.map((q) => (
                      <li key={q.email} className="min-w-0">
                        <button
                          type="button" disabled={!!busy} onClick={() => void go(q.email, DEMO_PASSWORD, "signin")}
                          className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-ink-50 active:bg-ink-100 disabled:opacity-60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base font-semibold text-ink-900">{q.name}</span>
                            <span className="block truncate text-xs text-ink-500">{q.sub} · {q.email}</span>
                          </span>
                          <span className="shrink-0 text-xs font-semibold text-primary">{busy === q.email ? "Signing in…" : "Sign in"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <p className="mt-auto pt-8 text-center text-xs text-ink-500">Built for Vasant Valley School families · location is shared only with verified members.</p>
    </div>
  );
}
