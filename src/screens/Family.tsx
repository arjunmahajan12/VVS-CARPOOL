// Family — children (add / edit / remove), add-on logins (spouse, grandparent,
// driver…) with driver confirmation, and trusted pickup persons.
import { useState, type FormEvent } from "react";
import { ArrowLeft, Car, Mail, Pencil, Plus, ShieldCheck, Trash2, TriangleAlert, UserPlus, Users } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import { classLabel } from "../lib/format";
import type { Addon, Child } from "../lib/types";
import { Avatar, Button, Card, EmptyState, IconButton, Input, Pill, SectionTitle, Select, TopBar, useConfirm, useToast } from "../components/ui";

const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `Class ${i + 1}` }));
const GENDER_OPTIONS = [{ value: "female", label: "Girl" }, { value: "male", label: "Boy" }, { value: "other", label: "Prefer not to say" }];
const RELATIONS = [
  { value: "spouse", label: "Spouse" }, { value: "grandparent", label: "Grandparent" }, { value: "sibling", label: "Sibling" },
  { value: "nanny", label: "Nanny / house help" }, { value: "driver", label: "Family driver" },
];

type ChildForm = { name: string; class_level: string; gender: string; allergies: string; emergency_name: string; emergency_phone: string };
const emptyChild = (): ChildForm => ({ name: "", class_level: "1", gender: "", allergies: "", emergency_name: "", emergency_phone: "" });
const fromChild = (c: Child): ChildForm => ({ name: c.name, class_level: String(c.class_level), gender: c.gender ?? "", allergies: c.allergies ?? "", emergency_name: c.emergency_name ?? "", emergency_phone: c.emergency_phone ?? "" });

function ChildEditor({ initial, onCancel, onSave, busy }: { initial: ChildForm; onCancel: () => void; onSave: (f: ChildForm) => void; busy: boolean }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof ChildForm>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }));
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { setErr("A name helps the driver greet the right child."); return; }
    onSave(f);
  }
  return (
    <form onSubmit={submit} className="anim-rise grid gap-3">
      <Input label="Name" placeholder="Child's name" value={f.name} onChange={(e) => { set("name", e.target.value); setErr(null); }} error={err} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Select label="Class" options={CLASS_OPTIONS} value={f.class_level} onChange={(e) => set("class_level", e.target.value)} />
        <Select label="Gender" placeholder="Optional" options={GENDER_OPTIONS} value={f.gender} onChange={(e) => set("gender", e.target.value)} />
      </div>
      <Input label="Allergies / medical note" hint="Shown to the driver on every trip." placeholder="e.g. peanut allergy — EpiPen in bag" value={f.allergies} onChange={(e) => set("allergies", e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Emergency contact" placeholder="Name" value={f.emergency_name} onChange={(e) => set("emergency_name", e.target.value)} />
        <Input label="Their phone" type="tel" inputMode="tel" placeholder="+91…" value={f.emergency_phone} onChange={(e) => set("emergency_phone", e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" full loading={busy}>Save child</Button>
      </div>
    </form>
  );
}

export default function Family() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const u = user!;
  const [busy, setBusy] = useState<string | null>(null);
  const [childMode, setChildMode] = useState<"idle" | "add" | { edit: string }>("idle");
  const [addonOpen, setAddonOpen] = useState(false);
  const [addon, setAddon] = useState({ name: "", email: "", relation: "spouse" });
  const [addonErr, setAddonErr] = useState<Record<string, string>>({});
  const [trustedOpen, setTrustedOpen] = useState(false);
  const [trusted, setTrusted] = useState({ name: "", phone: "" });
  const [trustedErr, setTrustedErr] = useState<Record<string, string>>({});

  async function run(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key);
    try { await fn(); await refresh(); toast.ok(okMsg); return true; }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Something went wrong."); return false; }
    finally { setBusy(null); }
  }

  const childPayload = (f: ChildForm) => ({
    name: f.name.trim(), class_level: Number(f.class_level) || 1, gender: f.gender || null,
    allergies: f.allergies.trim() || null, emergency_name: f.emergency_name.trim() || null, emergency_phone: f.emergency_phone.trim() || null,
  });
  async function saveChild(f: ChildForm) {
    const ok = childMode === "add"
      ? await run("child", () => api.addChild(childPayload(f)), `${f.name.trim()} added to your family.`)
      : typeof childMode === "object" ? await run("child", () => api.updateChild(childMode.edit, childPayload(f)), "Child updated.") : false;
    if (ok) setChildMode("idle");
  }
  async function removeChild(c: Child) {
    if (!(await confirm({ title: `Remove ${c.name}?`, message: "They'll be taken off your family profile and every carpool rider list. This can't be undone.", confirmLabel: "Remove" }))) return;
    await run(`rm-${c.id}`, () => api.removeChild(c.id), `${c.name} removed.`);
  }

  async function saveAddon(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!addon.name.trim()) err.name = "Their name.";
    if (!/^\S+@\S+\.\S+$/.test(addon.email.trim())) err.email = "The email they'll sign up with.";
    setAddonErr(err);
    if (Object.keys(err).length) return;
    const ok = await run("addon", () => api.addAddon({ name: addon.name.trim(), email: addon.email.trim().toLowerCase(), relation: addon.relation }), `Invite ready — ask ${addon.name.trim()} to sign up with ${addon.email.trim()}.`);
    if (ok) { setAddon({ name: "", email: "", relation: "spouse" }); setAddonOpen(false); }
  }
  async function removeAddon(a: Addon) {
    if (!(await confirm({ title: `Remove ${a.name}?`, message: "They'll lose access to your family's trips and alerts right away.", confirmLabel: "Remove" }))) return;
    await run(`rm-${a.id}`, () => api.removeAddon(a.id), `${a.name} removed.`);
  }
  async function confirmDriver(a: Addon, val: boolean) {
    if (val && !(await confirm({ title: `Confirm ${a.name} to drive?`, message: "They'll be able to start and drive your carpool's trips with live GPS. Only confirm someone you trust with the children.", confirmLabel: "Confirm driver", danger: false, icon: ShieldCheck }))) return;
    await run(`drv-${a.id}`, () => api.confirmDriver(a.id, val), val ? `${a.name} is confirmed to drive.` : `${a.name} can no longer drive trips.`);
  }

  async function saveTrusted(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!trusted.name.trim()) err.name = "Their name.";
    if (!/^[+\d][\d\s-]{7,}$/.test(trusted.phone.trim())) err.phone = "A phone number the driver can call.";
    setTrustedErr(err);
    if (Object.keys(err).length) return;
    const ok = await run("trusted", () => api.addTrusted({ name: trusted.name.trim(), phone: trusted.phone.trim() }), `${trusted.name.trim()} added as a trusted pickup.`);
    if (ok) { setTrusted({ name: "", phone: "" }); setTrustedOpen(false); }
  }
  async function removeTrusted(id: string, name: string) {
    if (!(await confirm({ title: `Remove ${name}?`, message: "The driver will no longer see them as approved to receive your child.", confirmLabel: "Remove" }))) return;
    await run(`rm-${id}`, () => api.removeTrusted(id), `${name} removed.`);
  }

  const editing = typeof childMode === "object" ? u.children.find((c) => c.id === childMode.edit) : null;

  return (
    <div className="anim-rise">
      <TopBar title="Family" onBack={() => nav.back()} />
      <div className="grid gap-5 px-4 pb-8 pt-4 *:min-w-0">
        {/* Children */}
        <section>
          <SectionTitle count={u.children.length || undefined} action={childMode === "idle" ? <Button size="sm" variant="soft" icon={Plus} onClick={() => setChildMode("add")}>Add child</Button> : undefined}>Children</SectionTitle>
          <Card padding="none" className="mt-2 px-4">
            {u.children.length === 0 && childMode === "idle" && (
              <EmptyState icon={Users} title="No children yet" sub="Add each child who rides — the driver sees their name, class and any medical note." action={<Button size="sm" variant="soft" icon={Plus} onClick={() => setChildMode("add")}>Add child</Button>} />
            )}
            {u.children.map((c) => (
              <div key={c.id} className="border-b border-line py-3 last:border-b-0">
                {typeof childMode === "object" && childMode.edit === c.id && editing ? (
                  <ChildEditor initial={fromChild(editing)} busy={busy === "child"} onCancel={() => setChildMode("idle")} onSave={saveChild} />
                ) : (
                  <div className="flex items-center gap-3">
                    <Avatar name={c.name} src={c.photo_url} size="md" tone="primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-ink-900">{c.name}</p>
                      <p className="truncate text-sm text-ink-500">{classLabel(c.class_level)}{c.gender ? ` · ${GENDER_OPTIONS.find((g) => g.value === c.gender)?.label ?? c.gender}` : ""}{c.emergency_phone ? ` · Emergency ${c.emergency_phone}` : ""}</p>
                      {c.allergies && <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-danger-ink"><TriangleAlert size={12} aria-hidden /> {c.allergies}</p>}
                    </div>
                    <IconButton icon={Pencil} label={`Edit ${c.name}`} size="sm" onClick={() => setChildMode({ edit: c.id })} />
                    <IconButton icon={Trash2} label={`Remove ${c.name}`} size="sm" variant="danger" loading={busy === `rm-${c.id}`} onClick={() => void removeChild(c)} />
                  </div>
                )}
              </div>
            ))}
            {childMode === "add" && (
              <div className="py-3"><ChildEditor initial={emptyChild()} busy={busy === "child"} onCancel={() => setChildMode("idle")} onSave={saveChild} /></div>
            )}
          </Card>
        </section>

        {/* Add-on logins */}
        <section>
          <SectionTitle count={u.addons.length || undefined} sub="Spouse, grandparent, nanny or driver — they sign up with the same email and are linked automatically." action={!addonOpen ? <Button size="sm" variant="soft" icon={UserPlus} onClick={() => setAddonOpen(true)}>Add login</Button> : undefined}>Family logins</SectionTitle>
          <Card padding="none" className="mt-2 px-4">
            {u.addons.length === 0 && !addonOpen && (
              <EmptyState icon={UserPlus} title="Just you so far" sub="Add a spouse or grandparent so they can follow trips too, or a family driver who can drive your carpool." />
            )}
            {u.addons.map((a) => {
              const isDrv = a.relation === "driver";
              return (
                <div key={a.id} className="border-b border-line py-3 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <Avatar name={a.name} size="md" tone={isDrv ? "accent" : "info"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-ink-900">{a.name}</p>
                      <p className="truncate text-sm text-ink-500">{RELATIONS.find((r) => r.value === a.relation)?.label ?? a.relation ?? "Add-on"} · {a.email}</p>
                    </div>
                    {a.signed_up === false && <Pill size="sm" tone="neutral">Not signed up yet</Pill>}
                    <IconButton icon={Trash2} label={`Remove ${a.name}`} size="sm" variant="danger" loading={busy === `rm-${a.id}`} onClick={() => void removeAddon(a)} />
                  </div>
                  {isDrv && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-13">
                      {a.driver_status === "verified" ? (
                        <>
                          <Pill size="sm" tone="ok" dot><ShieldCheck size={12} aria-hidden /> Confirmed to drive</Pill>
                          {a.vehicle?.plate && <Pill size="sm" tone="neutral"><Car size={12} aria-hidden /> {a.vehicle.plate}</Pill>}
                          <Button size="sm" variant="ghost" loading={busy === `drv-${a.id}`} onClick={() => void confirmDriver(a, false)}>Un-confirm</Button>
                        </>
                      ) : a.signed_up === false ? (
                        <p className="inline-flex items-center gap-1.5 text-xs text-ink-500"><Mail size={12} aria-hidden /> Ask them to sign up with {a.email} first.</p>
                      ) : (
                        <>
                          <Pill size="sm" tone="warn">Not confirmed to drive</Pill>
                          <Button size="sm" variant="soft" icon={ShieldCheck} loading={busy === `drv-${a.id}`} onClick={() => void confirmDriver(a, true)}>Confirm to drive</Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {addonOpen && (
              <form onSubmit={saveAddon} className="anim-rise grid gap-3 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Name" placeholder="e.g. Ramesh" value={addon.name} onChange={(e) => setAddon((s) => ({ ...s, name: e.target.value }))} error={addonErr.name} autoFocus />
                  <Select label="Relation" options={RELATIONS} value={addon.relation} onChange={(e) => setAddon((s) => ({ ...s, relation: e.target.value }))} />
                </div>
                <Input label="Email" type="email" inputMode="email" placeholder="they@example.com" hint="They must sign up with exactly this email." value={addon.email} onChange={(e) => setAddon((s) => ({ ...s, email: e.target.value }))} error={addonErr.email} />
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setAddonOpen(false)}>Cancel</Button>
                  <Button type="submit" full loading={busy === "addon"}>Create invite</Button>
                </div>
              </form>
            )}
          </Card>
        </section>

        {/* Trusted pickups */}
        <section>
          <SectionTitle count={u.trusted?.length || undefined} sub="People allowed to receive your child at drop-off. The driver sees this list on every trip." action={!trustedOpen ? <Button size="sm" variant="soft" icon={Plus} onClick={() => setTrustedOpen(true)}>Add person</Button> : undefined}>Trusted pickups</SectionTitle>
          <Card padding="none" className="mt-2 px-4">
            {(u.trusted?.length ?? 0) === 0 && !trustedOpen && (
              <EmptyState icon={ShieldCheck} title="Nobody listed" sub="Add a grandparent, neighbour or nanny who may collect your child if you're not home." />
            )}
            {(u.trusted ?? []).map((t) => (
              <div key={t.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
                <Avatar name={t.name} size="md" tone="ok" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink-900">{t.name}</p>
                  <p className="truncate text-sm text-ink-500 tnum">{t.phone}</p>
                </div>
                <IconButton icon={Trash2} label={`Remove ${t.name}`} size="sm" variant="danger" loading={busy === `rm-${t.id}`} onClick={() => void removeTrusted(t.id, t.name)} />
              </div>
            ))}
            {trustedOpen && (
              <form onSubmit={saveTrusted} className="anim-rise grid gap-3 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Name" value={trusted.name} onChange={(e) => setTrusted((s) => ({ ...s, name: e.target.value }))} error={trustedErr.name} autoFocus />
                  <Input label="Phone" type="tel" inputMode="tel" placeholder="+91…" value={trusted.phone} onChange={(e) => setTrusted((s) => ({ ...s, phone: e.target.value }))} error={trustedErr.phone} />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setTrustedOpen(false)}>Cancel</Button>
                  <Button type="submit" full loading={busy === "trusted"}>Add person</Button>
                </div>
              </form>
            )}
          </Card>
        </section>

        <Button variant="ghost" icon={ArrowLeft} onClick={() => nav.back()}>Back to profile</Button>
      </div>
    </div>
  );
}
