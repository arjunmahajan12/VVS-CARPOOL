# push — Web Push Edge Function
1. `node scripts/vapid.mjs` → copy both keys.
2. `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@school.in`
3. `supabase functions deploy push --no-verify-jwt`
4. In SQL: `update settings set vapid_public_key='<VAPID_PUBLIC_KEY>' where id=1;` (the app reads it via app_push_public_key()).
5. Dashboard → Database → Webhooks → Create: table `notifications`, event INSERT, type "Supabase Edge Function" → `push`.
Then Profile → Settings → "Push notifications" in the app to subscribe a device.
