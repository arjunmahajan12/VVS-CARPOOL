// Supabase Edge Function: sends a Web Push to every device of the notified user.
// Triggered by a Database Webhook on INSERT into public.notifications.
// Secrets (set with `supabase secrets set`): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto:you@school.in), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const n = body.record ?? body; // webhook payload: { type, table, record }
    if (!n?.user_id) return new Response("no user", { status: 200 });
    const db = createClient(url, key);
    const { data: subs } = await db.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", n.user_id);
    const payload = JSON.stringify({ title: n.title, body: n.body, kind: n.kind, url: "/#/alerts" });
    const dead: string[] = [];
    await Promise.all((subs ?? []).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint); }
    }));
    if (dead.length) await db.from("push_subscriptions").delete().in("endpoint", dead);
    return new Response(JSON.stringify({ sent: (subs?.length ?? 0) - dead.length, pruned: dead.length }), { headers: { "content-type": "application/json" } });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});
