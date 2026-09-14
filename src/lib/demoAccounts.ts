// The seeded demo families exist in two places: in memory (demo mode) and,
// once supabase/seed_demo.sql has been run, in a live Supabase project.
export const DEMO_PASSWORD = "demo1234";
export const isDemoAccount = (email?: string | null): boolean =>
  !!email && (/@demo\.in$/i.test(email) || /@vasantvalley\.demo$/i.test(email));
