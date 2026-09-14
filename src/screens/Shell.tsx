// Shell — routes the signed-in app. Tab routes render inside a scrolling
// <main> with the TabBar; pushed routes (carpool, trip, chat…) render
// full-height without it. Admin users get the Admin screen on the Home tab.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { emitRefresh } from "../lib/bus";
import { nav, useRoute, type Route, type Tab } from "../lib/nav";
import { APP_TABS, TabBar, useToast } from "../components/ui";
import type { Notification } from "../lib/types";

import Home from "./Home";
import Alerts from "./Alerts";
import Profile from "./Profile";
import Family from "./Family";
import Car from "./Car";
import Settings from "./Settings";
import Discover from "./Discover";
import Carpools from "./Carpools";
import CarpoolDetail from "./CarpoolDetail";
import LiveTrip from "./LiveTrip";
import History from "./History";
import Replay from "./Replay";
import Chat from "./Chat";
import Admin from "./Admin";

const ADMIN_TAB_FOR: Partial<Record<Tab, Route & { name: "admin" }>> = {
  home: { name: "admin", tab: "dashboard" },
  discover: { name: "admin", tab: "verify" },
  carpools: { name: "admin", tab: "carpools" },
};

/** Which tab a route belongs to (for the TabBar highlight). */
function tabOf(r: Route, isAdmin: boolean): Tab {
  if (r.name === "tab") return r.tab;
  if (r.name === "admin") {
    if (isAdmin) return r.tab === "verify" ? "discover" : r.tab === "carpools" ? "carpools" : "home";
    return "home";
  }
  if (r.name === "family" || r.name === "car" || r.name === "documents" || r.name === "settings" || r.name === "history") return "profile";
  if (r.name === "carpool" || r.name === "chat") return "carpools";
  return "home";
}

/** Routes that show the tab bar (everything except immersive map/trip screens). */
function showsTabBar(r: Route): boolean {
  return r.name === "tab" || r.name === "admin";
}

export default function Shell() {
  const { user, refresh } = useAuth();
  const route = useRoute();
  const toast = useToast();
  const isAdmin = user?.role === "admin";
  // Family add-ons (grandparents, drivers, helpers) follow trips and alerts —
  // they don't discover families or manage the family, so no Discover tab.
  const isAddon = user?.role === "addon";
  const tabs = APP_TABS.filter((t) => !(isAddon && t.key === "discover"));
  const [unread, setUnread] = useState(0);

  const loadUnread = useCallback(async () => {
    try {
      const list = await api.notifications();
      setUnread(list.filter((n) => !n.read).length);
    } catch { /* transient */ }
  }, []);

  useEffect(() => {
    void loadUnread();
    const off = api.onNotifications((n: Notification) => {
      setUnread((u) => u + 1);
      // Something changed (trip started, approval, invite…) — refresh the profile
      // and tell every screen to re-load so the app updates by itself.
      void refresh();
      emitRefresh();
      if (n.kind === "trip" || n.kind === "safety") toast({ title: n.title, message: n.body ?? undefined, tone: n.kind === "safety" ? "warn" : "info" });
    });
    return off;
  }, [loadUnread, refresh, toast]);

  // Reading the inbox clears the badge.
  useEffect(() => {
    if (route.name === "tab" && route.tab === "alerts") setUnread(0);
  }, [route]);

  // Scroll to top on every route change.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [route]);

  const activeTab = tabOf(route, !!isAdmin);
  const withTabs = showsTabBar(route);

  function onTab(t: Tab) {
    if (isAdmin) {
      const adminRoute = ADMIN_TAB_FOR[t];
      if (adminRoute) { nav.reset(); nav.replace(adminRoute); return; }
    }
    nav.tab(t);
  }

  let screen: ReactNode;
  switch (route.name) {
    case "tab":
      screen =
        route.tab === "home" ? (isAdmin ? <Admin tab="dashboard" /> : <Home />)
        : route.tab === "discover" ? (isAdmin ? <Admin tab="verify" /> : isAddon ? <Home /> : <Discover />)
        : route.tab === "carpools" ? (isAdmin ? <Admin tab="carpools" /> : <Carpools />)
        : route.tab === "alerts" ? <Alerts onRead={() => setUnread(0)} />
        : <Profile />;
      break;
    case "admin": screen = <Admin tab={route.tab} />; break;
    case "carpool": screen = <CarpoolDetail id={route.id} />; break;
    case "trip": screen = <LiveTrip rideId={route.rideId} />; break;
    case "history": screen = <History />; break;
    case "replay": screen = <Replay rideId={route.rideId} />; break;
    case "chat": screen = <Chat carpoolId={route.carpoolId} />; break;
    case "family": screen = <Family />; break;
    case "car": case "documents": screen = <Car />; break;
    case "settings": screen = <Settings />; break;
    default: screen = <Home />;
  }

  return (
    <div className="relative min-h-dvh">
      <main className={withTabs ? "pb-tabbar" : undefined}>{screen}</main>
      {withTabs && (
        <TabBar
          tabs={tabs.map((t) => (t.key === "alerts" ? { ...t, badge: unread || undefined } : t))}
          active={activeTab}
          onChange={onTab}
          className="mx-auto max-w-[480px]"
        />
      )}
    </div>
  );
}
