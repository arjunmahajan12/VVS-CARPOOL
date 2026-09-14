// Single data API the whole UI talks to. Auto-selects the live Supabase
// backend when env vars are present, otherwise the in-memory demo backend.
import type { Backend } from "./backend";
import { IS_LIVE } from "./supabaseClient";
import { demoBackend } from "./demo";
import { supabaseBackend } from "./supabaseBackend";

export const api: Backend = IS_LIVE ? supabaseBackend : demoBackend;
export const MODE: "live" | "demo" = IS_LIVE ? "live" : "demo";

// Demo-only test hook: lets the browser e2e suite drive the backend directly
// (e.g. inject a drive-past to test the missed-pickup UI). Never set in live.
if (MODE === "demo" && typeof window !== "undefined") (window as unknown as { __vvsApi?: Backend }).__vvsApi = api;
