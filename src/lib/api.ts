// Single data API the whole UI talks to. Auto-selects the live Supabase
// backend when env vars are present, otherwise the in-memory demo backend.
import type { Backend } from "./backend";
import { IS_LIVE } from "./supabaseClient";
import { demoBackend } from "./demo";
import { supabaseBackend } from "./supabaseBackend";

export const api: Backend = IS_LIVE ? supabaseBackend : demoBackend;
export const MODE: "live" | "demo" = IS_LIVE ? "live" : "demo";
