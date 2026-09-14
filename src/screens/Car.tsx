// Car & documents — vehicle details riders will recognise, plus licence /
// insurance / PUC / ID with expiry. Used by car-owning parents and family drivers.
import { useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, Car as CarIcon, Clock3, FileText, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import { fmtDate } from "../lib/format";
import type { DocType, DriverDoc, Vehicle } from "../lib/types";
import { Button, Card, EmptyState, IconButton, Input, Pill, SectionTitle, Select, TopBar, useConfirm, useToast, type PillTone } from "../components/ui";

const DOC_TYPES: { value: DocType; label: string; hint: string }[] = [
  { value: "licence", label: "Driving licence", hint: "DL number" },
  { value: "insurance", label: "Car insurance", hint: "Policy number" },
  { value: "puc", label: "PUC certificate", hint: "Certificate number" },
  { value: "id", label: "Photo ID", hint: "Aadhaar / passport (last 4 digits are fine)" },
];
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label])) as Record<DocType, string>;
const DOC_TONE: Record<DriverDoc["status"], PillTone> = { verified: "ok", pending: "warn", rejected: "danger" };
const DOC_STATUS: Record<DriverDoc["status"], string> = { verified: "Verified", pending: "Under review", rejected: "Rejected" };

function expiryState(expiry: string): { label: string; tone: PillTone } | null {
  const t = new Date(expiry).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.round((t - Date.now()) / 86_400_000);
  if (days < 0) return { label: "Expired", tone: "danger" };
  if (days <= 30) return { label: `Expires in ${days} d`, tone: "warn" };
  return null;
}

export default function Car() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const u = user!;
  const isDriver = u.role === "addon" && u.relation === "driver";
  const [v, setV] = useState<Required<Vehicle>>({ make_model: u.vehicle?.make_model ?? "", color: u.vehicle?.color ?? "", plate: u.vehicle?.plate ?? "", seats: u.vehicle?.seats ?? 4 });
  const [vErr, setVErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [doc, setDoc] = useState<{ type: DocType; number: string; expiry: string }>({ type: "licence", number: "", expiry: "" });
  const [docErr, setDocErr] = useState<Record<string, string>>({});
  const docs = u.documents ?? [];
  const dirty = useMemo(() => v.make_model !== (u.vehicle?.make_model ?? "") || v.color !== (u.vehicle?.color ?? "") || v.plate !== (u.vehicle?.plate ?? "") || v.seats !== (u.vehicle?.seats ?? 4), [v, u.vehicle]);
  const missing = DOC_TYPES.filter((d) => !docs.some((x) => x.type === d.value));

  async function saveVehicle(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!v.make_model.trim()) err.make_model = "e.g. Maruti Ertiga";
    if (!/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{4}$/i.test(v.plate.trim())) err.plate = "Use the number-plate format, e.g. DL 3C AB 1234";
    if (!(v.seats >= 1 && v.seats <= 8)) err.seats = "1–8 passenger seats";
    setVErr(err);
    if (Object.keys(err).length) return;
    setBusy("vehicle");
    try {
      await api.updateDriverProfile({ vehicle: { make_model: v.make_model.trim(), color: v.color.trim(), plate: v.plate.trim().toUpperCase(), seats: v.seats } });
      await refresh();
      toast.ok("Car saved — riders will see it on every trip.");
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't save the car."); }
    finally { setBusy(null); }
  }

  async function addDoc(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!doc.number.trim()) err.number = "Document number.";
    if (!doc.expiry) err.expiry = "Expiry date.";
    else if (new Date(doc.expiry).getTime() < Date.now()) err.expiry = "This document has already expired.";
    setDocErr(err);
    if (Object.keys(err).length) return;
    setBusy("doc");
    try {
      await api.addDriverDoc({ type: doc.type, number: doc.number.trim(), expiry: doc.expiry });
      await refresh();
      toast.ok(`${DOC_LABEL[doc.type]} added.`);
      setDoc({ type: missing.find((m) => m.value !== doc.type)?.value ?? "licence", number: "", expiry: "" });
      setDocOpen(false);
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't add the document."); }
    finally { setBusy(null); }
  }
  async function removeDoc(d: DriverDoc) {
    if (!(await confirm({ title: `Remove ${DOC_LABEL[d.type]}?`, message: "You'll need to add it again before driving trips.", confirmLabel: "Remove" }))) return;
    setBusy(`rm-${d.id}`);
    try { await api.removeDriverDoc(d.id); await refresh(); toast.ok("Document removed."); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't remove it."); }
    finally { setBusy(null); }
  }

  return (
    <div className="anim-rise">
      <TopBar title="Car & documents" onBack={() => nav.back()} />
      <div className="grid gap-5 px-4 pb-8 pt-4 *:min-w-0">
        {isDriver && (
          <Card padding="md" className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${u.driver_status === "verified" ? "bg-ok-soft text-ok-ink" : "bg-warn-soft text-warn-ink"}`}>
              {u.driver_status === "verified" ? <BadgeCheck size={20} strokeWidth={2.25} aria-hidden /> : <Clock3 size={20} strokeWidth={2.25} aria-hidden />}
            </span>
            <div className="min-w-0 flex-1 text-sm text-ink-700">
              <p className="text-base font-semibold text-ink-900">{u.driver_status === "verified" ? "Confirmed to drive" : u.driver_status === "pending" ? "Waiting for the family to confirm you" : "Not ready to drive yet"}</p>
              <p className="mt-0.5 text-pretty">{u.driver_status === "verified" ? "You can start and drive the family's carpool trips." : "Add your car and documents below, then the family confirms you from their Family page."}</p>
            </div>
          </Card>
        )}

        <section>
          <SectionTitle sub="What riders look for at the kerb.">Your car</SectionTitle>
          <Card padding="md" className="mt-2">
            <form onSubmit={saveVehicle} className="grid gap-3">
              <Input label="Make & model" placeholder="e.g. Maruti Ertiga" leftIcon={CarIcon} value={v.make_model} onChange={(e) => setV((s) => ({ ...s, make_model: e.target.value }))} error={vErr.make_model} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Colour" placeholder="e.g. Silver" value={v.color} onChange={(e) => setV((s) => ({ ...s, color: e.target.value }))} />
                <Input label="Passenger seats" type="number" inputMode="numeric" min={1} max={8} value={String(v.seats)} onChange={(e) => setV((s) => ({ ...s, seats: Number(e.target.value) || 0 }))} error={vErr.seats} />
              </div>
              <Input label="Number plate" placeholder="DL 3C AB 1234" className="uppercase tnum" autoCapitalize="characters" value={v.plate} onChange={(e) => setV((s) => ({ ...s, plate: e.target.value }))} error={vErr.plate} />
              <Button type="submit" full loading={busy === "vehicle"} disabled={!dirty && !!u.vehicle?.plate}>{u.vehicle?.plate ? "Save changes" : "Save car"}</Button>
            </form>
          </Card>
        </section>

        <section>
          <SectionTitle count={docs.length || undefined} sub="The school checks these before you drive children." action={!docOpen && missing.length ? <Button size="sm" variant="soft" icon={Plus} onClick={() => { setDoc((d) => ({ ...d, type: missing[0].value })); setDocOpen(true); }}>Add</Button> : undefined}>Documents</SectionTitle>
          <Card padding="none" className="mt-2 px-4">
            {docs.length === 0 && !docOpen && (
              <EmptyState icon={FileText} title="No documents yet" sub="Add your driving licence, insurance and PUC. Numbers only — no uploads needed." action={<Button size="sm" variant="soft" icon={Plus} onClick={() => setDocOpen(true)}>Add document</Button>} />
            )}
            {docs.map((d) => {
              const ex = expiryState(d.expiry);
              return (
                <div key={d.id} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><FileText size={20} strokeWidth={2.25} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-ink-900">{DOC_LABEL[d.type] ?? d.type}</p>
                    <p className="truncate text-sm text-ink-500 tnum">{d.number} · valid till {fmtDate(d.expiry, { day: "numeric", month: "short", year: "numeric" })}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill size="sm" tone={DOC_TONE[d.status]}>{DOC_STATUS[d.status]}</Pill>
                    {ex && <Pill size="sm" tone={ex.tone}>{ex.label}</Pill>}
                  </div>
                  <IconButton icon={Trash2} label={`Remove ${DOC_LABEL[d.type]}`} size="sm" variant="danger" loading={busy === `rm-${d.id}`} onClick={() => void removeDoc(d)} />
                </div>
              );
            })}
            {docs.length > 0 && missing.length > 0 && !docOpen && (
              <p className="flex items-center gap-1.5 py-3 text-xs text-ink-500"><ShieldAlert size={13} className="text-warn" aria-hidden /> Still missing: {missing.map((m) => m.label).join(", ")}.</p>
            )}
            {docOpen && (
              <form onSubmit={addDoc} className="anim-rise grid gap-3 py-3">
                <Select label="Document" options={DOC_TYPES.map((d) => ({ value: d.value, label: d.label }))} value={doc.type} onChange={(e) => setDoc((s) => ({ ...s, type: e.target.value as DocType }))} />
                <Input label="Number" placeholder={DOC_TYPES.find((d) => d.value === doc.type)?.hint} className="tnum" value={doc.number} onChange={(e) => setDoc((s) => ({ ...s, number: e.target.value }))} error={docErr.number} autoFocus />
                <Input label="Valid till" type="date" value={doc.expiry} onChange={(e) => setDoc((s) => ({ ...s, expiry: e.target.value }))} error={docErr.expiry} />
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setDocOpen(false)}>Cancel</Button>
                  <Button type="submit" full loading={busy === "doc"}>Add document</Button>
                </div>
              </form>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
