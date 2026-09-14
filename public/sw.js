// VVS Carpool service worker — web push only (no offline caching).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: "VVS Carpool", body: e.data && e.data.text() }; }
  const title = data.title || "VVS Carpool";
  const opts = {
    body: data.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag || data.kind || "vvs",
    renotify: !!data.renotify,
    data: { url: data.url || "/#/alerts" },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#/alerts";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
      return self.clients.openWindow(url);
    }),
  );
});
