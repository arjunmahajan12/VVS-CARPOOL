// Web-push client (v8). Registers the service worker, subscribes with the
// school's VAPID key and hands the subscription to the backend. Every step is
// a graceful no-op when the browser can't do push or no key is configured —
// the in-app inbox is always the fallback.
import type { Backend } from "./backend";
import type { PushSubscriptionJSON } from "./types";

const SW_URL = "/sw.js";

export type PushSupport = "supported" | "unsupported" | "insecure";

/** Can this browser do web push at all (and are we on https / localhost)? */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (!window.isSecureContext) return "insecure";
  return "supported";
}

export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupport() === "supported" ? Notification.permission : "unsupported";
}

/** Register (or fetch) the service worker. Resolves null when unsupported or when registration fails. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (pushSupport() !== "supported") return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_URL);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch {
    return null;
  }
}

function base64UrlToUint8Array(s: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toJSON(sub: PushSubscription): PushSubscriptionJSON | null {
  const j = sub.toJSON();
  const p256dh = j.keys?.p256dh, auth = j.keys?.auth;
  if (!j.endpoint || !p256dh || !auth) return null;
  return { endpoint: j.endpoint, keys: { p256dh, auth } };
}

export type SubscribeResult =
  | { ok: true; endpoint: string }
  | { ok: false; reason: "unsupported" | "insecure" | "no-key" | "denied" | "failed" };

/**
 * Ask for permission (if needed), subscribe with the backend's VAPID key and
 * store the subscription. Safe to call repeatedly — an existing subscription is reused.
 */
export async function subscribePush(api: Pick<Backend, "pushPublicKey" | "savePushSubscription">): Promise<SubscribeResult> {
  const support = pushSupport();
  if (support !== "supported") return { ok: false, reason: support };
  let key: string | null = null;
  try { key = await api.pushPublicKey(); } catch { key = null; }
  if (!key) return { ok: false, reason: "no-key" };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "failed" };

  try {
    if (Notification.permission === "denied") return { ok: false, reason: "denied" };
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return { ok: false, reason: "denied" };
    }
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(key) });
    const json = toJSON(sub);
    if (!json) return { ok: false, reason: "failed" };
    await api.savePushSubscription(json, navigator.userAgent);
    return { ok: true, endpoint: json.endpoint };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Unsubscribe this device and tell the backend. Never throws. */
export async function unsubscribePush(api: Pick<Backend, "removePushSubscription">): Promise<boolean> {
  if (pushSupport() !== "supported") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try { await api.removePushSubscription(endpoint); } catch { /* backend may already have dropped it */ }
    return true;
  } catch {
    return false;
  }
}

/** Is this device currently subscribed? (false when unsupported) */
export async function isPushSubscribed(): Promise<boolean> {
  if (pushSupport() !== "supported") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}
