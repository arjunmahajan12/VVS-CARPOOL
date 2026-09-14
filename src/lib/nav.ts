// Tiny in-app router (no deps). Routes are a discriminated union so screens
// are type-safe; state lives in a store + URL hash so refresh/back work.
import { useSyncExternalStore } from "react";

export type Tab = "home" | "discover" | "carpools" | "alerts" | "profile";
export type Route =
  | { name: "tab"; tab: Tab }
  | { name: "carpool"; id: string }
  | { name: "trip"; rideId: string }
  | { name: "history" }
  | { name: "replay"; rideId: string }
  | { name: "chat"; carpoolId: string }
  | { name: "family" } | { name: "car" } | { name: "documents" } | { name: "settings" }
  | { name: "admin"; tab: "dashboard" | "verify" | "carpools" | "incidents" | "settings" | "notices" };

const HOME: Route = { name: "tab", tab: "home" };
let stack: Route[] = [parse(location.hash) ?? HOME];
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); };

function serialize(r: Route): string {
  switch (r.name) {
    case "tab": return `#/${r.tab}`;
    case "carpool": return `#/carpool/${r.id}`;
    case "trip": return `#/trip/${r.rideId}`;
    case "replay": return `#/replay/${r.rideId}`;
    case "chat": return `#/chat/${r.carpoolId}`;
    case "admin": return `#/admin/${r.tab}`;
    default: return `#/${r.name}`;
  }
}
function parse(h: string): Route | null {
  const p = h.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!p.length) return null;
  const [a, b] = p;
  if (["home", "discover", "carpools", "alerts", "profile"].includes(a)) return { name: "tab", tab: a as Tab };
  if (a === "carpool" && b) return { name: "carpool", id: b };
  if (a === "trip" && b) return { name: "trip", rideId: b };
  if (a === "replay" && b) return { name: "replay", rideId: b };
  if (a === "chat" && b) return { name: "chat", carpoolId: b };
  if (a === "admin") return { name: "admin", tab: (b as any) || "dashboard" };
  if (["history", "family", "car", "documents", "settings"].includes(a)) return { name: a } as Route;
  return null;
}

export const nav = {
  current: (): Route => stack[stack.length - 1],
  go(r: Route) { stack = [...stack, r]; try { history.pushState(null, "", serialize(r)); } catch { /* ignore */ } emit(); },
  replace(r: Route) { stack = [...stack.slice(0, -1), r]; try { history.replaceState(null, "", serialize(r)); } catch { /* ignore */ } emit(); },
  back() { if (stack.length > 1) { stack = stack.slice(0, -1); try { history.back(); } catch { /* ignore */ } emit(); } else nav.replace(HOME); },
  tab(t: Tab) { stack = [{ name: "tab", tab: t }]; try { history.replaceState(null, "", serialize(stack[0])); } catch { /* ignore */ } emit(); },
  reset() { stack = [HOME]; try { history.replaceState(null, "", serialize(HOME)); } catch { /* ignore */ } emit(); },
};
window.addEventListener("popstate", () => { const r = parse(location.hash); if (r) { stack = stack.length > 1 ? stack.slice(0, -1) : [r]; if (JSON.stringify(nav.current()) !== JSON.stringify(r)) stack = [...stack.slice(0, -1), r]; emit(); } });

export function useRoute(): Route {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, nav.current, nav.current);
}
export function activeTab(r: Route): Tab | null { return r.name === "tab" ? r.tab : null; }
