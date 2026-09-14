import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// With both vars present the app runs LIVE against Supabase; without them it
// falls back to the in-memory demo backend (great for local preview).
export const IS_LIVE = !!(url && anon);
export const supabase = IS_LIVE ? createClient(url!, anon!) : null;
