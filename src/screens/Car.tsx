// Car — the vehicle details riders look for at the kerb. Used by car-owning
// parents and family drivers. (No document uploads — the family confirms a
// driver directly from their Family page.)
import { useMemo, useState, type FormEvent } from "react";
import { BadgeCheck, Car as CarIcon, Clock3 } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import type { Vehicle } from "../lib/types";
import { Button, Card, Input, SectionTitle, TopBar, useToast } from "../components/ui";

export default function Car() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const u = user!;
  const isDriver = u.role === "addon" && u.relation === "driver";
  const [v, setV] = useState<Required<Vehicle>>({ make_model: u.vehicle?.make_model ?? "", color: u.vehicle?.color ?? "", plate: u.vehicle?.plate ?? "", seats: u.vehicle?.seats ?? 4 });
  const [vErr, setVErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => v.make_model !== (u.vehicle?.make_model ?? "") || v.color !== (u.vehicle?.color ?? "") || v.plate !== (u.vehicle?.plate ?? "") || v.seats !== (u.vehicle?.seats ?? 4), [v, u.vehicle]);

  async function saveVehicle(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!v.make_model.trim()) err.make_model = "e.g. Maruti Ertiga";
    if (!/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{4}$/i.test(v.plate.trim())) err.plate = "Use the number-plate format, e.g. DL 3C AB 1234";
    if (!(v.seats >= 1 && v.seats <= 8)) err.seats = "1–8 passenger seats";
    setVErr(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      await api.updateDriverProfile({ vehicle: { make_model: v.make_model.trim(), color: v.color.trim(), plate: v.plate.trim().toUpperCase(), seats: v.seats } });
      await refresh();
      toast.ok("Car saved — riders will see it on every trip.");
    } catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't save the car."); }
    finally { setBusy(false); }
  }

  return (
    <div className="anim-rise">
      <TopBar title="Your car" onBack={() => nav.back()} />
      <div className="grid gap-5 px-4 pb-8 pt-4 *:min-w-0">
        {isDriver && (
          <Card padding="md" className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${u.driver_status === "verified" ? "bg-ok-soft text-ok-ink" : "bg-warn-soft text-warn-ink"}`}>
              {u.driver_status === "verified" ? <BadgeCheck size={20} strokeWidth={2.25} aria-hidden /> : <Clock3 size={20} strokeWidth={2.25} aria-hidden />}
            </span>
            <div className="min-w-0 flex-1 text-sm text-ink-700">
              <p className="text-base font-semibold text-ink-900">{u.driver_status === "verified" ? "Confirmed to drive" : "Waiting for the family to confirm you"}</p>
              <p className="mt-0.5 text-pretty">{u.driver_status === "verified" ? "You can start and drive the family's carpool trips." : "Save your car below; the family confirms you from their Family page."}</p>
            </div>
          </Card>
        )}

        <section>
          <SectionTitle sub="What riders look for at the kerb.">Vehicle</SectionTitle>
          <Card padding="md" className="mt-2">
            <form onSubmit={saveVehicle} className="grid gap-3">
              <Input label="Make & model" placeholder="e.g. Maruti Ertiga" leftIcon={CarIcon} value={v.make_model} onChange={(e) => setV((s) => ({ ...s, make_model: e.target.value }))} error={vErr.make_model} />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Colour" placeholder="e.g. Silver" value={v.color} onChange={(e) => setV((s) => ({ ...s, color: e.target.value }))} />
                <Input label="Passenger seats" type="number" inputMode="numeric" min={1} max={8} value={String(v.seats)} onChange={(e) => setV((s) => ({ ...s, seats: Number(e.target.value) || 0 }))} error={vErr.seats} />
              </div>
              <Input label="Number plate" placeholder="DL 3C AB 1234" className="uppercase tnum" autoCapitalize="characters" value={v.plate} onChange={(e) => setV((s) => ({ ...s, plate: e.target.value }))} error={vErr.plate} />
              <Button type="submit" full loading={busy} disabled={!dirty && !!u.vehicle?.plate}>{u.vehicle?.plate ? "Save changes" : "Save car"}</Button>
            </form>
          </Card>
        </section>
      </div>
    </div>
  );
}
