// Carpools — my carpools with a live badge, seats and organiser; invites I can
// accept/decline; join requests the organiser approves. "New carpool" (car
// owners only) leads to Discover, where a carpool is created from neighbours.
import { useCallback, useEffect, useState } from "react";
import { Car, Check, ChevronRight, Compass, Plus, UserPlus, X } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { keepFresh } from "../lib/bus";
import { nav } from "../lib/nav";
import type { Carpool, Member } from "../lib/types";
import { Avatar, AvatarStack, Button, Card, EmptyState, LiveBadge, Pill, SectionTitle, Skeleton, TopBar, useConfirm, useToast } from "../components/ui";

export default function Carpools() {
  const { user } = useAuth();
  const u = user!;
  const toast = useToast();
  const confirm = useConfirm();
  const [pools, setPools] = useState<Carpool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canDrive = u.role === "parent" && u.can_drive !== false;
  const isAddon = u.role === "addon";

  const load = useCallback(async () => {
    try { setPools(await api.myCarpools()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load your carpools."); setPools((p) => p ?? []); }
  }, []);
  useEffect(() => keepFresh(load, 15000), [load]);

  const mine = (pools ?? []).filter((c) => c.is_creator || c.my_status === "joined");
  const invites = (pools ?? []).filter((c) => c.my_status === "invited");
  const requested = (pools ?? []).filter((c) => c.my_status === "requested");
  const requestsForMe = (pools ?? []).flatMap((c) => (c.is_creator ? c.members.filter((m) => m.status === "requested").map((m) => ({ c, m })) : []));

  async function respondInvite(c: Carpool, accept: boolean) {
    if (accept && !(await confirm({ title: `Join "${c.name}"?`, message: "By joining, your name, phone number, child's name and approximate home are shared with this carpool's families, and the organiser's household will drive your child. Continue?", confirmLabel: "Join carpool", danger: false }))) return;
    setBusy(`inv:${c.id}`);
    try { await api.respondInvite(c.id, accept); toast[accept ? "ok" : "info"](accept ? `You've joined "${c.name}".` : "Invite declined."); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't respond."); }
    finally { setBusy(null); }
  }
  async function respondRequest(c: Carpool, m: Member, accept: boolean) {
    setBusy(`req:${c.id}:${m.parent_id}`);
    try { await api.respondJoinRequest(c.id, m.parent_id, accept); toast[accept ? "ok" : "info"](accept ? `${m.parent_name} has joined "${c.name}".` : "Request declined."); await load(); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't respond."); }
    finally { setBusy(null); }
  }

  return (
    <div className="anim-rise min-h-dvh">
      <TopBar
        variant="large" title="Carpools" sub={pools ? `${mine.length} joined` : undefined}
        right={canDrive ? <Button size="sm" icon={Plus} onClick={() => nav.tab("discover")}>New carpool</Button> : undefined}
      />
      <div className="grid gap-4 px-4 pb-6 pt-1 *:min-w-0">
        {error && <Card variant="outline" padding="sm" className="flex items-center gap-3 text-sm"><span className="min-w-0 flex-1 text-ink-700">{error}</span><Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button></Card>}

        {invites.length > 0 && (
          <section>
            <SectionTitle variant="eyebrow" count={invites.length}>Invites for you</SectionTitle>
            <div className="mt-1 grid gap-2 *:min-w-0">
              {invites.map((c) => (
                <Card key={c.id} padding="md" className="grid gap-3 *:min-w-0">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink"><UserPlus size={20} strokeWidth={2.25} aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-ink-900">{c.name}</p>
                      <p className="text-sm text-ink-500"><b className="text-ink-700">{c.creator_name ?? "A neighbour"}</b> invited your family · {c.joined.length} {c.joined.length === 1 ? "family" : "families"} · <span className="tnum">{c.seats_used ?? 0}/{c.seats ?? "—"}</span> seats</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 *:min-w-0">
                    <Button variant="ghost" icon={X} loading={busy === `inv:${c.id}`} onClick={() => respondInvite(c, false)}>Decline</Button>
                    <Button icon={Check} loading={busy === `inv:${c.id}`} onClick={() => respondInvite(c, true)}>Accept</Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {requestsForMe.length > 0 && (
          <section>
            <SectionTitle variant="eyebrow" count={requestsForMe.length}>Seat requests</SectionTitle>
            <Card padding="none" className="mt-1 divide-y divide-line px-4">
              {requestsForMe.map(({ c, m }) => (
                <div key={`${c.id}:${m.parent_id}`} className="flex items-center gap-3 py-3">
                  <Avatar name={m.parent_name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-ink-900">{m.parent_name}</p>
                    <p className="truncate text-sm text-ink-500">wants a seat in {c.name}{m.colony ? ` · ${m.colony}` : ""}</p>
                  </div>
                  <Button size="sm" variant="ghost" loading={busy === `req:${c.id}:${m.parent_id}`} onClick={() => respondRequest(c, m, false)}>Decline</Button>
                  <Button size="sm" loading={busy === `req:${c.id}:${m.parent_id}`} onClick={() => respondRequest(c, m, true)}>Approve</Button>
                </div>
              ))}
            </Card>
          </section>
        )}

        <section>
          <SectionTitle variant="eyebrow" count={pools ? mine.length : undefined}>My carpools</SectionTitle>
          <div className="mt-1">
            {pools === null ? (
              <Card padding="sm"><Skeleton variant="row" lines={3} /></Card>
            ) : mine.length === 0 ? (
              <Card>
                <EmptyState
                  icon={Car}
                  title={isAddon ? "No family carpool yet" : canDrive ? "No carpool yet" : "You're not in a carpool yet"}
                  sub={isAddon ? "Once the parent joins or creates a carpool, it appears here." : canDrive ? "Pick a few neighbours on the map and create one — you drive, they ride along." : "Request a seat in a carpool near you; the organiser confirms and you're in."}
                  action={isAddon ? undefined : <Button size="sm" variant="soft" icon={Compass} onClick={() => nav.tab("discover")}>{canDrive ? "Find neighbours" : "Find a carpool"}</Button>}
                />
              </Card>
            ) : (
              <div className="grid gap-2 *:min-w-0">
                {mine.map((c) => {
                  const names = c.joined.map((m) => m.parent_name);
                  const kids = (c.riders ?? []).length;
                  return (
                    <Card key={c.id} padding="md" onClick={() => nav.go({ name: "carpool", id: c.id })}>
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-soft-ink"><Car size={22} strokeWidth={2.25} aria-hidden /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-display text-md font-bold text-ink-950">{c.name}</span>
                            {c.active_ride && <LiveBadge />}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
                            <Pill size="sm" tone={c.is_org_household ? "primary" : "neutral"}>{c.is_creator ? "You organise" : `${c.creator_name ?? "Organiser"} drives`}</Pill>
                            <span className="tnum">{c.seats_used ?? kids}/{c.seats ?? "—"} seats</span>
                            {c.driver_vehicle && <span className="tnum">{c.driver_vehicle}</span>}
                          </p>
                        </div>
                        <ChevronRight size={18} className="mt-1 shrink-0 text-ink-300" aria-hidden />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <AvatarStack names={names} size="xs" max={4} />
                        <span className="text-xs text-ink-500">{c.active_ride ? <span className="font-semibold text-accent-soft-ink">Trip in progress — tap to track</span> : `${names.length} ${names.length === 1 ? "family" : "families"} · ${kids} ${kids === 1 ? "child" : "children"}`}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {requested.length > 0 && (
          <section>
            <SectionTitle variant="eyebrow" count={requested.length}>Awaiting approval</SectionTitle>
            <Card padding="none" className="mt-1 divide-y divide-line px-4">
              {requested.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-info-soft text-info-ink"><Car size={20} aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-ink-900">{c.name}</p>
                    <p className="truncate text-sm text-ink-500">{c.creator_name ?? "The organiser"} will confirm your seat</p>
                  </div>
                  <Pill tone="info" dot="pulse">Requested</Pill>
                </div>
              ))}
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
