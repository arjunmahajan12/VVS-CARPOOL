// Discover — full-bleed map of families and carpools around my home with a
// radius ring, filters, and a sheet that ranks everything by distance. A
// parent with a car multi-selects families and creates a carpool with them;
// a car-less parent sees carpools only and requests a seat.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Car, Check, Compass, MapPin, Plus, Route, SlidersHorizontal, Users, X } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import { classLabel } from "../lib/format";
import type { Discovery, Filters, NearbyCarpool, ParentPin } from "../lib/types";
import { Avatar, Button, Card, Chip, EmptyState, IconButton, Input, Pill, SegmentedControl, Skeleton, TopBar, useToast, cn } from "../components/ui";
import { BottomSheet, MapView, SheetHeader, VVS, useSheetInset, type MapPin as Pin } from "../components/map";

const RADII = ["1", "2", "3", "5", "all"] as const;
type Seg = "families" | "carpools";
type Gender = "" | "female" | "male";

const fmtKm = (km: number | null | undefined) => (km == null ? "—" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
const kidsLine = (p: ParentPin) => p.children.map((k) => `${k.name.split(" ")[0]} · ${classLabel(k.class_level)}`).join(", ");

export default function Discover() {
  const { user } = useAuth();
  const u = user!;
  const toast = useToast();
  const sheet = useSheetInset();
  const canDrive = u.role === "parent" && u.can_drive !== false;
  const approved = u.status === "approved";

  const [radius, setRadius] = useState<(typeof RADII)[number]>("3");
  const [gender, setGender] = useState<Gender>("");
  const [sameClass, setSameClass] = useState(false);
  const [samePin, setSamePin] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [data, setData] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seg, setSeg] = useState<Seg>(canDrive ? "families" : "carpools");
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [seats, setSeats] = useState("4");
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [snap, setSnap] = useState<number | undefined>(undefined);

  const myClasses = useMemo(() => u.children.map((c) => c.class_level), [u.children]);
  const filters = useMemo<Filters>(() => {
    const f: Filters = { radius_km: radius };
    if (gender) f.gender = gender;
    if (sameClass && myClasses.length) { f.class_min = String(Math.min(...myClasses) - 1); f.class_max = String(Math.max(...myClasses) + 1); }
    if (samePin && u.pincode) f.pincode = u.pincode;
    return f;
  }, [radius, gender, sameClass, samePin, myClasses, u.pincode]);

  const load = useCallback(async () => {
    try { setData(await api.searchParents(filters)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load neighbours."); setData((d) => d ?? { school: { name: "", lat: VVS[0], lng: VVS[1] }, me: {}, parents: [], carpools: [] }); }
  }, [filters]);
  useEffect(() => { if (approved) void load(); }, [load, approved]);

  const home = data?.me.home_lat != null && data.me.home_lng != null ? { lat: data.me.home_lat, lng: data.me.home_lng } : u.home_lat != null && u.home_lng != null ? { lat: u.home_lat, lng: u.home_lng } : null;
  const school = data?.school ?? null;
  const parents = data?.parents ?? [];
  const carpools = data?.carpools ?? [];

  const pins = useMemo<Pin[]>(() => {
    const out: Pin[] = [];
    if (school) out.push({ id: "school", kind: "school", lat: school.lat, lng: school.lng, label: school.name || "School" });
    if (home) out.push({ id: "home", kind: "home", lat: home.lat, lng: home.lng, label: "Your home" });
    parents.forEach((p) => { if (p.home_lat != null && p.home_lng != null) out.push({ id: `f:${p.id}`, kind: "family", lat: p.home_lat, lng: p.home_lng, label: p.name, sub: fmtKm(p.distance_km), selected: selectedPin === `f:${p.id}` || picked.includes(p.id) }); });
    carpools.forEach((c) => { if (c.lat != null && c.lng != null) out.push({ id: `c:${c.id}`, kind: "carpool", lat: c.lat, lng: c.lng, label: c.name, sub: `${c.seats_used ?? 0}/${c.seats ?? "—"} seats`, selected: selectedPin === `c:${c.id}` }); });
    return out;
  }, [school, home, parents, carpools, selectedPin, picked]);

  const center: [number, number] = home ? [home.lat, home.lng] : school ? [school.lat, school.lng] : VVS;
  const ring = home && radius !== "all" ? { lat: home.lat, lng: home.lng, km: Number(radius) } : null;

  const selectedFamily = selectedPin?.startsWith("f:") ? parents.find((p) => `f:${p.id}` === selectedPin) ?? null : null;
  const selectedCarpool = selectedPin?.startsWith("c:") ? carpools.find((c) => `c:${c.id}` === selectedPin) ?? null : null;

  function onPinTap(id: string) {
    if (id === "home" || id === "school") { setSelectedPin(null); return; }
    setSelectedPin(id);
    setSeg(id.startsWith("c:") ? "carpools" : "families");
    setSnap(1);
  }
  const togglePick = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function requestSeat(c: NearbyCarpool) {
    setRequesting(c.id);
    try { await api.requestJoinCarpool(c.id); toast.ok(`Seat requested in "${c.name}" — the organiser will be notified.`); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't request a seat."); }
    finally { setRequesting(null); }
  }
  async function create() {
    const nm = name.trim();
    if (!nm) { toast.warn("Give your carpool a name."); return; }
    const n = Number(seats);
    if (!Number.isFinite(n) || n < 1 || n > 8) { toast.warn("Seats must be between 1 and 8."); return; }
    setBusy(true);
    try {
      const cp = await api.createCarpool({ name: nm, seats: n, invite_ids: picked });
      toast.ok(`"${cp.name}" created — ${picked.length} ${picked.length === 1 ? "family" : "families"} invited.`);
      setPicked([]); setCreating(false); setName("");
      nav.go({ name: "carpool", id: cp.id });
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't create the carpool."); }
    finally { setBusy(false); }
  }

  const activeFilterCount = (radius !== "3" ? 1 : 0) + (gender ? 1 : 0) + (sameClass ? 1 : 0) + (samePin ? 1 : 0);

  if (!approved) {
    return (
      <div className="min-h-dvh">
        <TopBar variant="large" title="Discover" />
        <div className="px-4"><Card><EmptyState size="page" icon={Compass} title="Neighbours appear once you're verified" sub="The school office checks every family first. You'll get an alert the moment you're approved." /></Card></div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden bg-bg" style={{ height: "calc(100dvh - 64px - env(safe-area-inset-bottom, 0px))" }}>
      <div className="absolute inset-0">
        <MapView className="h-full w-full" center={center} zoom={14}
        pins={pins} radius={ring} cluster padding={{ bottom: sheet.inset, top: 110 }} onPinTap={onPinTap}
      />
      </div>
      <TopBar
        variant="map" title="Discover" sub={home ? `${parents.length} ${parents.length === 1 ? "family" : "families"} · ${carpools.length} ${carpools.length === 1 ? "carpool" : "carpools"} nearby` : "Set your home pin in Profile"}
        right={<IconButton icon={SlidersHorizontal} label="Filters" variant="card" className="glass" dot={activeFilterCount > 0} onClick={() => { setShowFilters((s) => !s); setSnap(2); }} />}
      />

      <BottomSheet
        snapPoints={[0.2, 0.5, 0.92]} initial={1} snap={snap} onSnap={() => setSnap(undefined)} {...sheet.bind}
        header={
          <SheetHeader
            title={selectedFamily ? selectedFamily.name : selectedCarpool ? selectedCarpool.name : seg === "families" ? "Families near you" : "Carpools near you"}
            sub={selectedPin ? "Tap × to go back to the list" : "Ranked by distance from your home"}
            right={selectedPin
              ? <IconButton icon={X} label="Close" size="sm" onClick={() => setSelectedPin(null)} />
              : canDrive && picked.length > 0
                ? <Button size="sm" variant="accent" icon={Plus} onClick={() => { setCreating(true); setSnap(2); }}>Create with {picked.length}</Button>
                : null}
          />
        }
      >
        <div className="grid gap-3 pb-2 *:min-w-0">
          {/* chips row (always) */}
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
            {RADII.map((r) => <Chip key={r} size="sm" selected={radius === r} onClick={() => setRadius(r)}>{r === "all" ? "Any distance" : `${r} km`}</Chip>)}
          </div>
          {showFilters && (
            <Card variant="inset" padding="sm" className="grid gap-3 *:min-w-0">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold text-ink-700">Children</span>
                <SegmentedControl size="sm" label="Gender" value={gender} onChange={setGender} options={[{ value: "", label: "Any" }, { value: "female", label: "Girls" }, { value: "male", label: "Boys" }]} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" selected={sameClass} disabled={!myClasses.length} onClick={() => setSameClass((s) => !s)}>Close to my child's class</Chip>
                <Chip size="sm" selected={samePin} disabled={!u.pincode} onClick={() => setSamePin((s) => !s)}>My pincode{u.pincode ? ` · ${u.pincode}` : ""}</Chip>
                {activeFilterCount > 0 && <Chip size="sm" onClick={() => { setRadius("3"); setGender(""); setSameClass(false); setSamePin(false); }}>Reset</Chip>}
              </div>
            </Card>
          )}

          {error && <Card variant="outline" padding="sm" className="flex items-center gap-3 text-sm"><span className="min-w-0 flex-1 text-ink-700">{error}</span><Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button></Card>}

          {/* create form */}
          {creating && canDrive && (
            <Card padding="md" className="grid gap-3 *:min-w-0">
              <div>
                <p className="font-display text-md font-bold text-ink-950">New carpool</p>
                <p className="text-sm text-ink-500">You'll drive. {picked.length} {picked.length === 1 ? "family gets" : "families get"} an invite they can accept from their Carpools tab.</p>
              </div>
              <Input label="Carpool name" placeholder="e.g. B-Block morning run" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <Input label="Seats for children" type="number" inputMode="numeric" min={1} max={8} value={seats} onChange={(e) => setSeats(e.target.value)} hint="Not counting the driver." />
              <div className="flex flex-wrap gap-1.5">
                {picked.map((id) => { const p = parents.find((x) => x.id === id); return p ? <Chip key={id} size="sm" selected onRemove={() => togglePick(id)}>{p.name.split(" ")[0]}</Chip> : null; })}
              </div>
              <div className="grid grid-cols-2 gap-2 *:min-w-0">
                <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>Back</Button>
                <Button loading={busy} onClick={create} icon={Car}>Create carpool</Button>
              </div>
            </Card>
          )}

          {/* selected pin card */}
          {!creating && selectedFamily && <FamilyCard p={selectedFamily} canDrive={canDrive} picked={picked.includes(selectedFamily.id)} onPick={() => togglePick(selectedFamily.id)} expanded />}
          {!creating && selectedCarpool && <CarpoolCard c={selectedCarpool} busy={requesting === selectedCarpool.id} onRequest={() => requestSeat(selectedCarpool)} expanded />}

          {!creating && !selectedPin && (
            <>
              {!canDrive && (
                <Card variant="inset" padding="sm" className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-primary-soft text-primary-soft-ink"><Car size={18} aria-hidden /></span>
                  <div className="min-w-0 text-sm text-ink-700"><b className="text-ink-900">Join a carpool.</b> Families without a car ride along — request a seat in a carpool below and the organiser will confirm.</div>
                </Card>
              )}
              <SegmentedControl full label="What to show" value={seg} onChange={setSeg}
                options={[{ value: "families", label: `Families · ${parents.length}`, icon: Users }, { value: "carpools", label: `Carpools · ${carpools.length}`, icon: Car }]} />

              {data === null ? (
                <Skeleton variant="row" lines={4} />
              ) : seg === "families" ? (
                parents.length === 0 ? (
                  <EmptyState icon={MapPin} title="No families in this radius" sub="Widen the radius or clear a filter — new families appear as the school verifies them." action={radius !== "all" ? <Button size="sm" variant="soft" onClick={() => setRadius("all")}>Show any distance</Button> : undefined} />
                ) : (
                  <div className="grid gap-2 *:min-w-0">
                    {canDrive && <p className="text-xs text-ink-500">Tap to select the families you'd drive, then create a carpool.</p>}
                    {parents.map((p) => <FamilyCard key={p.id} p={p} canDrive={canDrive} picked={picked.includes(p.id)} onPick={() => togglePick(p.id)} onOpen={() => onPinTap(`f:${p.id}`)} />)}
                  </div>
                )
              ) : carpools.length === 0 ? (
                <EmptyState icon={Car} title="No carpools nearby yet" sub={canDrive ? "Be the first — select a few families and create one." : "Ask a neighbour with a car to create one, or widen the radius."} />
              ) : (
                <div className="grid gap-2 *:min-w-0">
                  {carpools.map((c) => <CarpoolCard key={c.id} c={c} busy={requesting === c.id} onRequest={() => requestSeat(c)} onOpen={() => onPinTap(`c:${c.id}`)} />)}
                </div>
              )}
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

function FamilyCard({ p, canDrive, picked, onPick, onOpen, expanded }: { p: ParentPin; canDrive: boolean; picked: boolean; onPick: () => void; onOpen?: () => void; expanded?: boolean }) {
  const detour = p.distance_from_route_km;
  return (
    <Card padding="sm" className={cn("flex items-start gap-3 *:min-w-0", picked && "ring-2 ring-primary")}>
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen ?? (canDrive ? onPick : undefined)}>
        <Avatar name={p.name} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-ink-900">{p.name}</span>
            {p.existing_carpool && <Pill size="sm" tone="info">In a carpool</Pill>}
          </span>
          <span className="block truncate text-sm text-ink-500">{kidsLine(p)}</span>
          <span className="tnum mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden />{fmtKm(p.distance_km)} from you</span>
            {detour != null && <span className={cn("inline-flex items-center gap-1", detour < 0.8 && "text-ok-ink")}><Route size={12} aria-hidden />{detour < 0.3 ? "on your way" : `+${fmtKm(detour)} detour`}</span>}
            {p.colony && <span>{p.colony}</span>}
          </span>
          {expanded && (
            <span className="mt-2 block text-sm text-ink-700">
              {p.children.map((k) => `${k.name} (${classLabel(k.class_level)}${k.gender ? `, ${k.gender === "female" ? "girl" : "boy"}` : ""})`).join(" · ")}
              {p.pincode ? ` · ${p.pincode}` : ""}
            </span>
          )}
        </span>
      </button>
      {canDrive && (
        <button type="button" aria-pressed={picked} aria-label={picked ? `Deselect ${p.name}` : `Select ${p.name}`} onClick={onPick}
          className={cn("mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors", picked ? "bg-primary text-on-primary" : "bg-card text-ink-300 hairline hover:text-ink-500")}>
          <Check size={16} strokeWidth={3} aria-hidden />
        </button>
      )}
    </Card>
  );
}

function CarpoolCard({ c, busy, onRequest, onOpen, expanded }: { c: NearbyCarpool; busy: boolean; onRequest: () => void; onOpen?: () => void; expanded?: boolean }) {
  const status = c.my_status;
  const free = Math.max(0, (c.seats ?? 0) - (c.seats_used ?? 0));
  const canRequest = !status && !c.full;
  return (
    <Card padding="sm" className="flex items-start gap-3">
      <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onOpen}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ok-soft text-ok-ink"><Car size={20} strokeWidth={2.25} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-ink-900">{c.name}</span>
            {status === "requested" && <Pill size="sm" tone="info">Requested</Pill>}
            {status === "invited" && <Pill size="sm" tone="accent">Invited</Pill>}
            {c.full && !status && <Pill size="sm" tone="neutral">Full</Pill>}
          </span>
          <span className="block truncate text-sm text-ink-500">{c.creator_name ? `${c.creator_name} drives` : "Organiser"} · {c.members_count} {c.members_count === 1 ? "family" : "families"}</span>
          <span className="tnum mt-1 flex flex-wrap gap-x-3 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden />{fmtKm(c.distance_km)} from you</span>
            <span className={cn(free > 0 && "text-ok-ink")}>{free} of {c.seats ?? "—"} seats free</span>
          </span>
          {expanded && <span className="mt-2 block text-sm text-ink-700">Requesting a seat sends the organiser a request; once approved you'll see this carpool's trips live, get boarding alerts and join its chat.</span>}
        </span>
      </button>
      {canRequest && <Button size="sm" variant={expanded ? "primary" : "soft"} loading={busy} onClick={onRequest} className="mt-0.5 shrink-0">Request</Button>}
    </Card>
  );
}
