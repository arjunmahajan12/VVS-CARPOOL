// Map location picker (onboarding home pin, admin school pin).
// Tap the map to drop the pin, "use my location" for GPS, and — when a Mappls
// key is configured — an autosuggest search box. Keyless demo: no search box.
import { useEffect, useRef, useState } from "react";
import MapView from "./map/MapView";
import { VVS, num } from "./map/mapTypes";
import { HAS_MAPPLS, mapplsAutosuggest, resolveSuggestion, type MapplsSuggestion } from "../lib/mapProvider";

export interface PickedLocation { lat: number; lng: number; address?: string; colony?: string; pincode?: string }

export interface LocationPickerProps {
  value: PickedLocation | null;
  onChange: (v: PickedLocation) => void;
  className?: string;
  mapClassName?: string;      // default: h-64
  placeholder?: string;
  hint?: string | null;       // null hides the helper line
  pinLabel?: string;
}

export default function LocationPicker({
  value, onChange, className = "", mapClassName = "h-64", placeholder = "Search your address…",
  hint = "Search, use your location, or tap the map to drop the pin.", pinLabel = "Your pin",
}: LocationPickerProps) {
  const [q, setQ] = useState("");
  const [sugs, setSugs] = useState<MapplsSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);   // soft hint (e.g. approximate pin)
  const [placedGen, setPlacedGen] = useState(0); // bump = re-centre the map (search / GPS), not on tap
  const box = useRef<HTMLDivElement>(null);
  const has = !!value && num(value.lat) && num(value.lng);
  const center: [number, number] = has ? [value!.lat, value!.lng] : VVS;

  // autosuggest (debounced)
  useEffect(() => {
    if (!HAS_MAPPLS) return;
    let alive = true;
    if (q.trim().length < 3) { setSugs([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await mapplsAutosuggest(q, has ? { lat: value!.lat, lng: value!.lng } : { lat: VVS[0], lng: VVS[1] });
      if (!alive) return;
      setSugs(r.slice(0, 6)); setSearching(false); setOpen(true);
    }, 320);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  // close the list on outside tap
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);

  async function choose(s: MapplsSuggestion) {
    setQ(s.placeName); setOpen(false); setSugs([]); setError(null); setNote(null);
    setSearching(true);
    const c = await resolveSuggestion(s, has ? { lat: value!.lat, lng: value!.lng } : { lat: VVS[0], lng: VVS[1] });
    setSearching(false);
    if (!c) { setError("Couldn't get coordinates for that place — try a nearby landmark, or tap the map to drop the pin."); return; }
    const { lat, lng } = c;
    if (c.approx) setNote("We could only place the pin near that area — tap the map to put it exactly on your home.");
    const address = [s.placeName, s.placeAddress].filter(Boolean).join(", ");
    const pincode = address.match(/\b\d{6}\b/)?.[0];
    onChange({ lat, lng, address, pincode, colony: value?.colony });
    setPlacedGen((n) => n + 1);
  }
  function locateMe() {
    if (!navigator.geolocation) { setError("Location isn't available on this device."); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); onChange({ ...(value || {}), lat: p.coords.latitude, lng: p.coords.longitude, address: undefined, pincode: value?.pincode, colony: value?.colony }); setPlacedGen((n) => n + 1); },
      (err) => { setLocating(false); setError(err.code === 1 ? "Location permission was denied — tap the map to set your pin." : "Couldn't get your location — tap the map instead."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        {HAS_MAPPLS && (
          <div ref={box} className="relative min-w-0 flex-1">
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              type="search" inputMode="search" autoComplete="off" value={q} placeholder={placeholder} aria-label="Search address"
              onChange={(e) => setQ(e.target.value)} onFocus={() => sugs.length && setOpen(true)}
              className="h-11 w-full rounded-[14px] border pl-9 pr-9 text-[15px] outline-none transition focus:ring-2"
              style={{ background: "var(--color-card, #fff)", borderColor: "var(--color-ink-300, #CBD5E1)", color: "var(--color-ink-900, #111A2E)" }}
            />
            {searching && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-[#1F4B99]" aria-hidden />}
            {open && sugs.length > 0 && (
              <ul role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-[14px] border shadow-lg" style={{ background: "var(--color-card, #fff)", borderColor: "var(--color-ink-300, #CBD5E1)" }}>
                {sugs.map((s, i) => (
                  <li key={`${s.eLoc || s.placeName}-${i}`} role="option" aria-selected={false}>
                    <button type="button" onClick={() => choose(s)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5">
                      <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F4B99" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">{s.placeName}</span>
                        {s.placeAddress && <span className="block truncate text-[12px] text-slate-500 dark:text-slate-400">{s.placeAddress}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="button" onClick={locateMe} disabled={locating}
          className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-[14px] px-3.5 text-[13px] font-semibold transition active:scale-[0.98] disabled:opacity-60 ${HAS_MAPPLS ? "" : "flex-1 justify-center"}`}
          style={{ background: "var(--color-primary-soft, #E8EEF9)", color: "var(--color-primary-soft-ink, #173B7A)" }}
        >
          {locating
            ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>}
          Use my location
        </button>
      </div>

      <div className={`relative mt-2 overflow-hidden rounded-[20px] ${mapClassName}`}>
        <MapView
          center={center} zoom={15} className="h-full w-full"
          pins={has ? [{ id: `picked-${placedGen}`, lat: value!.lat, lng: value!.lng, kind: "home", label: pinLabel, selected: true }] : []}
          onMapTap={(lat, lng) => { setError(null); setNote(null); onChange({ lat, lng, colony: value?.colony, pincode: value?.pincode }); }}
        />
        {!has && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
            <span className="rounded-full bg-[#0B1220]/85 px-3 py-1.5 text-[12px] font-semibold text-white shadow">Tap the map to drop your pin</span>
          </div>
        )}
      </div>

      {(error || note || has || hint) && (
        <div className="mt-2 flex items-start gap-2 text-[12.5px] leading-snug">
          {error ? (
            <p className="text-rose-600 dark:text-rose-400">{error}</p>
          ) : note ? (
            <p className="text-amber-700 dark:text-amber-300">{note}</p>
          ) : has ? (
            <p className="min-w-0 text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-200">Pinned</span>
              {value!.address ? <> · <span className="break-words">{value!.address}</span></> : <> · {value!.lat.toFixed(5)}, {value!.lng.toFixed(5)}</>}
            </p>
          ) : hint ? (
            <p className="text-slate-400">{hint}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
