// Two small in-memory buses.
//
// 1. App-wide REFRESH bus. A screen registers `keepFresh(fn)` and its data
//    reloads on a timer, when the tab regains focus, and whenever any part of
//    the app calls `emitRefresh()` (e.g. after a notification lands) — so trips,
//    approvals and invites appear by themselves without switching tabs.
//
// 2. TOPIC bus used by the demo backend as its realtime transport (SPEC §8).
//    Topics mirror the Supabase channels one-to-one:
//      loc:<rideId>     LocPayload           (every accepted GPS fix)
//      rideev:<rideId>  RideEvent            (boarded / unboarded / arriving / …)
//      stops:<rideId>   Stop[]               (the whole stop rail, after any change)
//      ended:<rideId>   { ride_id }          (trip closed — manually or auto)
//      notif:<userId>   Notification         (inbox insert for that user)
//      chat:<carpoolId> ChatMessage          (new message)
type Fn = () => void;
const listeners = new Set<Fn>();

export function onRefresh(fn: Fn): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function emitRefresh(): void {
  listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
}

export function keepFresh(fn: () => void | Promise<void>, ms = 12000): () => void {
  let alive = true;
  const run = () => { if (alive) Promise.resolve(fn()).catch(() => { /* transient */ }); };
  run();
  const iv = window.setInterval(run, ms);
  const onFocus = () => run();
  window.addEventListener("focus", onFocus);
  const off = onRefresh(run);
  return () => {
    alive = false;
    window.clearInterval(iv);
    window.removeEventListener("focus", onFocus);
    off();
  };
}

// ---- topic bus -------------------------------------------------------------
export type TopicHandler<T = unknown> = (payload: T) => void;
const topics = new Map<string, Set<TopicHandler<never>>>();

/** Subscribe to a topic. Returns the unsubscribe function. */
export function on<T = unknown>(topic: string, handler: TopicHandler<T>): () => void {
  let set = topics.get(topic);
  if (!set) { set = new Set(); topics.set(topic, set); }
  set.add(handler as TopicHandler<never>);
  return () => {
    const s = topics.get(topic);
    if (!s) return;
    s.delete(handler as TopicHandler<never>);
    if (s.size === 0) topics.delete(topic);
  };
}

/** Publish to a topic. A throwing listener never breaks the publisher or its peers. */
export function emit<T = unknown>(topic: string, payload: T): void {
  const set = topics.get(topic);
  if (!set) return;
  // copy: a handler may unsubscribe itself (or others) while we iterate
  [...set].forEach((h) => { try { (h as TopicHandler<T>)(payload); } catch { /* listener error is not ours */ } });
}

/** Number of live subscribers on a topic (tests / diagnostics). */
export function subscriberCount(topic: string): number {
  return topics.get(topic)?.size ?? 0;
}
