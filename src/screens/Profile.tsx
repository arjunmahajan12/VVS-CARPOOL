// Profile — who you are, then rows into Family, Car & documents, Trip
// history and Settings. Contact & home pin edit inline. Add-ons get a
// view-only version that explains what they can do.
import { useState } from "react";
import { Car, Clock3, FileText, History, MapPin, Pencil, Settings as SettingsIcon, ShieldCheck, UserRound, Users } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import { classLabel } from "../lib/format";
import type { Profile as ProfileT } from "../lib/types";
import { Avatar, Button, Card, Input, ListRow, Pill, SectionTitle, TopBar, useToast, type PillTone } from "../components/ui";
import { LocationPicker, type PickedLocation } from "../components/map";

const STATUS: Record<ProfileT["status"], { label: string; tone: PillTone }> = {
  approved: { label: "Verified family", tone: "ok" },
  pending: { label: "Awaiting verification", tone: "warn" },
  rejected: { label: "Verification failed", tone: "danger" },
};

function ContactCard({ u, onSaved }: { u: ProfileT; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ phone: u.phone ?? "", address: u.address ?? "", colony: u.colony ?? "", pincode: u.pincode ?? "" });
  const [home, setHome] = useState<PickedLocation | null>(u.home_lat != null && u.home_lng != null ? { lat: u.home_lat, lng: u.home_lng, address: u.address ?? undefined } : null);

  function onLoc(l: PickedLocation) {
    setHome(l);
    setF((s) => ({ ...s, address: l.address ?? s.address, colony: l.colony ?? s.colony, pincode: l.pincode ?? s.pincode }));
  }
  async function save() {
    setBusy(true);
    try {
      await api.updateProfile({ phone: f.phone.trim(), address: f.address.trim(), colony: f.colony.trim(), pincode: f.pincode.trim(), ...(home ? { home_lat: home.lat, home_lng: home.lng } : {}) });
      await onSaved();
      toast.ok("Contact details saved.");
      setEditing(false);
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
  }

  const where = [u.colony, u.pincode].filter(Boolean).join(" · ");
  return (
    <Card padding="md">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><MapPin size={20} strokeWidth={2.25} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink-900">Home & contact</p>
          <p className="truncate text-sm text-ink-500">{editing ? "Only verified members ever see an approximate pin." : where || u.address || (u.home_lat != null ? "Pin set" : "No home pin yet")}{!editing && u.phone ? ` · ${u.phone}` : ""}</p>
        </div>
        {!editing && <Button size="sm" variant="soft" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {editing && (
        <div className="anim-rise mt-4 grid gap-3">
          <Input label="Phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))} />
          <LocationPicker value={home} onChange={onLoc} pinLabel="Home" mapClassName="h-52" />
          <Input label="Address line" value={f.address} onChange={(e) => setF((s) => ({ ...s, address: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Colony / area" value={f.colony} onChange={(e) => setF((s) => ({ ...s, colony: e.target.value }))} />
            <Input label="Pin code" inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => setF((s) => ({ ...s, pincode: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button full loading={busy} onClick={save}>Save</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Profile() {
  const { user, refresh } = useAuth();
  const u = user!;
  const st = STATUS[u.status] ?? STATUS.pending;
  const isAddon = u.role === "addon";
  const isDriver = isAddon && u.relation === "driver";
  const isAdmin = u.role === "admin";

  return (
    <div className="anim-rise">
      <TopBar variant="large" title="Profile" right={<Button size="sm" variant="ghost" icon={SettingsIcon} onClick={() => nav.go({ name: "settings" })}>Settings</Button>} />
      <div className="grid gap-4 px-4 pb-6 pt-1 *:min-w-0">
        <Card padding="lg" className="flex items-center gap-4">
          <Avatar name={u.name} src={u.photo_url} size="xl" ring />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg">{u.name}</h2>
            <p className="truncate text-sm text-ink-500">{u.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isAdmin ? <Pill tone="primary" size="sm">School admin</Pill>
                : isAddon ? <Pill tone="info" size="sm">{isDriver ? "Family driver" : `Family add-on${u.relation ? ` · ${u.relation}` : ""}`}</Pill>
                : <Pill tone={st.tone} size="sm" dot>{st.label}</Pill>}
              {!isAddon && !isAdmin && (u.can_drive !== false ? <Pill tone="neutral" size="sm">Has a car</Pill> : <Pill tone="neutral" size="sm">No car · rides along</Pill>)}
              {isDriver && (u.driver_status === "verified" ? <Pill tone="ok" size="sm" dot>Confirmed to drive</Pill> : <Pill tone="warn" size="sm">Not yet confirmed</Pill>)}
            </div>
          </div>
        </Card>

        {isAddon && (
          <Card padding="md" className="text-sm text-ink-700">
            <p className="font-semibold text-ink-900">You're linked to a family account</p>
            <p className="mt-1 text-pretty">
              {isDriver
                ? "Once the family confirms you, you can share live GPS on their carpool trips. Keep your car and documents up to date below."
                : "You can follow the family's trips and alerts. Children, carpools and contact details are managed by the parent."}
            </p>
          </Card>
        )}

        {!isAddon && !isAdmin && <ContactCard key={`${u.phone}-${u.home_lat}-${u.home_lng}`} u={u} onSaved={refresh} />}

        <section>
          <SectionTitle variant="eyebrow">{isAdmin ? "Account" : "Your family"}</SectionTitle>
          <Card padding="none" className="mt-2 px-4">
            {!isAddon && !isAdmin && (
              <ListRow
                divider leading={<Tile icon={Users} />} title="Family"
                sub={`${u.children.length} ${u.children.length === 1 ? "child" : "children"}${u.children.length ? ` · ${u.children.map((c) => `${c.name} (${classLabel(c.class_level)})`).join(", ")}` : ""} · ${u.addons.length} add-on${u.addons.length === 1 ? "" : "s"}`}
                onClick={() => nav.go({ name: "family" })}
              />
            )}
            {(isDriver || (!isAddon && !isAdmin && u.can_drive !== false)) && (
              <ListRow
                divider leading={<Tile icon={Car} />} title="Car & documents"
                sub={u.vehicle?.plate ? `${u.vehicle.make_model ?? "Car"} · ${u.vehicle.plate}` : "Add your car so riders recognise it"}
                trailing={u.documents?.length ? <Pill size="sm" tone={u.documents.every((d) => d.status === "verified") ? "ok" : "neutral"}>{u.documents.filter((d) => d.status === "verified").length}/{u.documents.length} verified</Pill> : undefined}
                onClick={() => nav.go({ name: "car" })}
              />
            )}
            {!isAdmin && <ListRow divider leading={<Tile icon={History} />} title="Trip history" sub="Every trip, on-time badges and replays" onClick={() => nav.go({ name: "history" })} />}
            <ListRow leading={<Tile icon={SettingsIcon} />} title="Settings" sub="Theme, push alerts, terms, sign out" onClick={() => nav.go({ name: "settings" })} />
          </Card>
        </section>

        {!isAddon && !isAdmin && (
          <section>
            <SectionTitle variant="eyebrow">Safety</SectionTitle>
            <Card padding="none" className="mt-2 px-4">
              <ListRow
                leading={<Tile icon={ShieldCheck} tone="bg-ok-soft text-ok-ink" />} title="Trusted pickup persons"
                sub={(u.trusted?.length ?? 0) ? u.trusted!.map((t) => t.name).join(", ") : "Who may receive your child at drop-off"}
                onClick={() => nav.go({ name: "family" })}
              />
            </Card>
          </section>
        )}

        {isAdmin && (
          <Card padding="md" className="flex items-start gap-3 text-sm text-ink-700">
            <FileText size={18} className="mt-0.5 shrink-0 text-ink-500" aria-hidden />
            <p>Verification, incidents, geofence rules and notices live on the Admin tabs. This account has no carpool of its own.</p>
          </Card>
        )}

        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500"><Clock3 size={12} aria-hidden /> Terms v{u.tnc_version || "—"}{u.needs_tnc ? " · new terms to accept in Settings" : ""} · <UserRound size={12} aria-hidden /> VVS Carpool v8</p>
      </div>
    </div>
  );
}

function Tile({ icon: Icon, tone = "bg-primary-soft text-primary-soft-ink" }: { icon: typeof Users; tone?: string }) {
  return <span className={`grid h-10 w-10 place-items-center rounded-md ${tone}`}><Icon size={20} strokeWidth={2.25} aria-hidden /></span>;
}
