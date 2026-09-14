// Mappls renderer — the ONLY provider when a key is configured. If the SDK
// can't load, an explicit error card with Retry is shown; it never falls back
// to another provider (product rule).
//
// SDK quirks (see icons.ts): markers take an icon URL that Mappls drops into
// CSS url(...), so every SVG is parenthesis-free; markers are bottom-centre
// anchored; the map object is MapLibre-flavoured (on/easeTo/fitBounds take
// [lng, lat]) while Mappls' own helpers take {lat, lng}. Every SDK call is
// wrapped — a missing method must never crash a screen.
import { useEffect, useId, useRef, useState } from "react";
import { num, VVS, type MapProps } from "./mapTypes";
import { ACCENT, PRIMARY, SLATE, WHITE, calloutIcon, carIcon, clusterIcon, etaChipIcon, etaLabel, pinIcon, stopIcon, type IconSpec } from "./icons";
import { boundsOf, clusterPins, fitView, frameSignature, framePoints, padBoundsKm, safePath, type LatLng } from "./mapUtils";
import { useCarGlide } from "./useCarGlide";
import { MapError, MapSkeleton } from "./MapChrome";
import { HAS_MAPPLS } from "../../lib/mapProvider";
import { MAPPLS_CLASS as CLASS, loadMappls } from "../../lib/mapProvider";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Layer = any;

const READY_FALLBACK_MS = 2500;

export default function MapplsMap(props: MapProps) {
  const {
    center, zoom = 13, pins = [], stops = [], route, travelled, car, carEta, fences = [], radius, corridor,
    follow = false, traffic = false, cluster = false, padding, className,
  } = props;
  const id = `vvs-map-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<Layer>(null);
  const shapes = useRef<Layer[]>([]);
  const pinLayers = useRef<Layer[]>([]);
  const stopLayers = useRef<Layer[]>([]);
  const carMarker = useRef<Layer>(null);
  const carHeadingQ = useRef<number>(-1);
  const etaMarker = useRef<Layer>(null);
  const etaText = useRef("");
  const fitSig = useRef("");
  const trafficOn = useRef(false);
  const resizeObs = useRef<ResizeObserver | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [zoomTick, setZoomTick] = useState(0);

  const cb = useRef(props); cb.current = props;
  const padTop = padding?.top ?? 0, padBottom = padding?.bottom ?? 0;
  const padRef = useRef({ top: padTop, bottom: padBottom }); padRef.current = { top: padTop, bottom: padBottom };

  // ---- helpers around the SDK (all best-effort)
  const remove = (layers: Layer[]) => {
    const m = map.current;
    for (const l of layers) { try { CLASS.removeLayer({ map: m, layer: l }); } catch { try { l?.remove?.(); } catch { /* gone */ } } }
    layers.length = 0;
  };
  const marker = (pos: LatLng, icon: IconSpec, zIndex: number, onClick?: () => void, extra: Record<string, unknown> = {}): Layer => {
    const m = map.current; if (!m) return null;
    let mk: Layer = null;
    try { mk = CLASS.Marker({ map: m, position: { lat: pos.lat, lng: pos.lng }, icon: icon.url, width: icon.width, height: icon.height, zIndex, clickable: !!onClick, ...extra }); } catch { return null; }
    if (mk && onClick) {
      let bound = false;
      try { if (typeof mk.addListener === "function") { mk.addListener("click", onClick); bound = true; } } catch { /* ignore */ }
      if (!bound) try { if (typeof mk.on === "function") { mk.on("click", onClick); bound = true; } } catch { /* ignore */ }
      if (!bound) try { const el = mk.getElement?.(); if (el) { el.style.cursor = "pointer"; el.addEventListener("click", onClick); } } catch { /* ignore */ }
    }
    return mk || null;
  };
  const polyline = (path: LatLng[], color: string, weight: number, opacity: number): Layer => {
    try { return CLASS.Polyline({ map: map.current, path, strokeColor: color, strokeWeight: weight, strokeOpacity: opacity, fitbounds: false }); } catch { return null; }
  };
  const circle = (c: LatLng, radiusM: number, color: string, fillOpacity: number, strokeOpacity: number, weight = 1.5): Layer => {
    try { return CLASS.Circle({ map: map.current, center: { lat: c.lat, lng: c.lng }, radius: radiusM, fillColor: color, fillOpacity, strokeColor: color, strokeOpacity, strokeWeight: weight }); } catch { return null; }
  };
  const getZoom = (): number => { try { const z = map.current?.getZoom?.(); return num(z) ? z : zoom; } catch { return zoom; } };
  const easeTo = (c: LatLng, opts: { zoom?: number; duration?: number; offsetY?: number } = {}) => {
    const m = map.current; if (!m) return;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : (opts.duration ?? 600);
    try {
      if (typeof m.easeTo === "function") { m.easeTo({ center: [c.lng, c.lat], zoom: opts.zoom, duration, offset: [0, opts.offsetY ?? 0], essential: true }); return; }
    } catch { /* fall through */ }
    try { m.panTo([c.lng, c.lat]); if (opts.zoom != null) m.setZoom(opts.zoom); } catch { /* ignore */ }
  };

  // ---- init / retry. StrictMode-safe: the async load checks `cancelled` and the cleanup removes the map.
  useEffect(() => {
    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    setFailed(null); setReady(false);
    fitSig.current = ""; etaText.current = ""; carHeadingQ.current = -1; trafficOn.current = false;
    const c0 = num(center?.[0]) && num(center?.[1]) ? center : VVS;
    loadMappls().then((ok) => {
      if (cancelled) return;
      if (!ok) { setFailed(HAS_MAPPLS ? "The Mappls SDK didn't load." : "Map key missing — set VITE_MAPPLS_KEY before building the app."); return; }
      if (!document.getElementById(id)) { setFailed("Map container went missing."); return; }
      let m: Layer = null;
      try {
        m = CLASS.Map({ id, properties: { center: [c0[0], c0[1]], zoom, zoomControl: false, fullscreenControl: false, traffic: !!cb.current.traffic } });
      } catch (e) { setFailed(String((e as Error)?.message || e)); return; }
      if (!m) { setFailed("The map couldn't be created."); return; }
      map.current = m;
      if ((window as unknown as { __vvsDebugMap?: boolean }).__vvsDebugMap) (window as unknown as { __vvsMap?: unknown }).__vvsMap = m; // test hook
      // The SDK measures its container once at creation; if the layout settles a
      // frame later (fonts, the sheet inset, dvh) the canvas stays small. Re-measure
      // whenever the holder changes size, and a few times right after creation.
      const remeasure = () => { try { m.resize?.(); } catch { /* ignore */ } try { window.dispatchEvent(new Event("resize")); } catch { /* ignore */ } };
      if (typeof ResizeObserver !== "undefined" && holder.current) {
        resizeObs.current = new ResizeObserver(() => remeasure());
        resizeObs.current.observe(holder.current);
      }
      [0, 150, 500, 1200].forEach((ms) => setTimeout(() => { if (!cancelled) remeasure(); }, ms));
      let done = false;
      const markReady = () => {
        if (done || cancelled) return; done = true;
        setReady(true); cb.current.onReady?.();
      };
      try { m.on("load", markReady); } catch { /* ignore */ }
      readyTimer = setTimeout(markReady, READY_FALLBACK_MS);
      try {
        m.on("click", (e: any) => {
          const lat = e?.lngLat?.lat ?? e?.latlng?.lat ?? e?.lat, lng = e?.lngLat?.lng ?? e?.latlng?.lng ?? e?.lng;
          if (num(lat) && num(lng)) cb.current.onMapTap?.(lat, lng);
        });
      } catch { /* ignore */ }
      try { m.on("zoomend", () => { if (!cancelled) setZoomTick((n) => n + 1); }); } catch { /* ignore */ }
    });
    return () => {
      cancelled = true;
      if (readyTimer) clearTimeout(readyTimer);
      try { resizeObs.current?.disconnect(); } catch { /* ignore */ } resizeObs.current = null;
      const m = map.current;
      shapes.current = []; pinLayers.current = []; stopLayers.current = [];
      carMarker.current = null; etaMarker.current = null;
      try { m?.remove?.(); } catch { /* ignore */ }
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // ---- traffic (best-effort; the SDK exposes mappls.traffic({map}))
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    const w: any = window;
    if (traffic && !trafficOn.current) {
      trafficOn.current = true;
      try { w?.mappls?.traffic?.({ map: m, visible: true }); } catch { /* ignore */ }
    } else if (!traffic && trafficOn.current) {
      trafficOn.current = false;
      try { w?.mappls?.traffic?.({ map: m, visible: false }); } catch { /* ignore */ }
    }
  }, [traffic, ready]);

  // ---- shapes
  const shapeKey = JSON.stringify([route, travelled, corridor, radius, fences]);
  useEffect(() => {
    if (!map.current || !ready) return;
    remove(shapes.current);
    const out = shapes.current;
    const cor = safePath(corridor);
    if (cor.length > 1) out.push(polyline(cor, PRIMARY, 22, 0.12));
    for (const f of fences) {
      if (!num(f.lat) || !num(f.lng) || !num(f.radiusM)) continue;
      const tone = f.tone === "stop" ? ACCENT : SLATE;
      out.push(circle(f, f.radiusM, tone, f.tone === "stop" ? 0.1 : 0.05, 0.55));
    }
    if (radius && num(radius.lat) && num(radius.lng) && num(radius.km)) {
      out.push(circle(radius, radius.km * 1000, PRIMARY, 0.05, 0.7)); // (Mappls circles can't be dashed)
      out.push(marker({ lat: radius.lat + radius.km / 111, lng: radius.lng }, kmLabelIcon(radius.km), 50));
    }
    const r = safePath(route);
    if (r.length > 1) { out.push(polyline(r, WHITE, 9, 0.95)); out.push(polyline(r, PRIMARY, 5, 0.95)); }
    const tr = safePath(travelled);
    if (tr.length > 1) { out.push(polyline(tr, WHITE, 9, 0.95)); out.push(polyline(tr, "#94A3B8", 5, 0.9)); }
    shapes.current = out.filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, ready]);

  // ---- pins (+ clustering)
  const pinKey = JSON.stringify(pins);
  useEffect(() => {
    if (!map.current || !ready) return;
    remove(pinLayers.current);
    const out: Layer[] = [];
    for (const cell of clusterPins(pins, getZoom(), cluster)) {
      if (cell.type === "cluster") {
        out.push(marker(cell, clusterIcon(cell.count), 300, () => easeTo(cell, { zoom: Math.min(18, getZoom() + 2), duration: 500 })));
        continue;
      }
      const p = cell.pin;
      out.push(marker(p, pinIcon(p.kind, !!p.selected), p.selected ? 500 : p.kind === "school" ? 200 : 100, () => cb.current.onPinTap?.(p.id)));
    }
    pinLayers.current = out.filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey, cluster, zoomTick, ready]);

  // ---- stops (+ callout)
  const stopKey = JSON.stringify(stops);
  useEffect(() => {
    if (!map.current || !ready) return;
    remove(stopLayers.current);
    const out: Layer[] = [];
    for (const s of stops) {
      if (!num(s.lat) || !num(s.lng)) continue;
      const big = s.kind === "school" || !!s.isNext;
      const ic = stopIcon(s.seq, s.status, !!s.isNext, big);
      out.push(marker(s, ic, s.isNext ? 600 : s.status === "stopped" ? 400 : 250, () => cb.current.onStopTap?.(s.id)));
      if (s.isNext) out.push(marker(s, calloutIcon(s.label, s.etaMin, ic.height + 2), 700));
    }
    stopLayers.current = out.filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey, ready]);

  // ---- fit bounds (first meaningful data / framed set changes; never while following)
  const sig = frameSignature({ stops, pins, route, radius });
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || follow || sig === fitSig.current) return;
    const { points, padKm } = framePoints({ stops, pins, route, radius, car });
    if (!points.length) return;
    fitSig.current = sig;
    let b = boundsOf(points); if (!b) return;
    if (padKm) b = padBoundsKm(b, padKm);
    const pad = { top: 28 + padRef.current.top, bottom: 28 + padRef.current.bottom, left: 28, right: 28 };
    if (points.length === 1 && !padKm) {
      // a lone point: only move if it isn't already comfortably on screen
      const p0 = points[0];
      let visible = false;
      try {
        const bb = m.getBounds?.(), px = m.project?.([p0.lng, p0.lat]);
        const h = holder.current?.clientHeight || 0;
        visible = getZoom() >= 13 && !!bb?.contains?.([p0.lng, p0.lat]) && (!px || px.y < h - pad.bottom - 12);
      } catch { visible = false; }
      if (!visible) easeTo(p0, { zoom: Math.max(getZoom(), 15), duration: 0, offsetY: -(pad.bottom - pad.top) / 2 });
      return;
    }
    let fitted = false;
    try {
      if (typeof m.fitBounds === "function") { m.fitBounds([[b.west, b.south], [b.east, b.north]], { padding: pad, maxZoom: 16, duration: 0 }); fitted = true; }
    } catch { fitted = false; }
    if (!fitted) {
      const el = holder.current;
      const v = fitView(b, el?.clientWidth || 390, el?.clientHeight || 600, pad, 16);
      easeTo(v.center, { zoom: v.zoom, duration: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready, follow]);

  // ---- car
  const setCarIcon = (heading: number) => {
    const q = Math.round(heading / 4) * 4;            // 4° steps keep icon churn low
    if (q === carHeadingQ.current || !carMarker.current) return;
    carHeadingQ.current = q;
    const ic = carIcon(q, false);
    const mk = carMarker.current;
    let ok = false;
    try { if (typeof mk.setIcon === "function") { mk.setIcon(ic.url); ok = true; } } catch { ok = false; }
    if (!ok) { // recreate at the current position
      let pos: LatLng | null = null;
      try { const p = mk.getPosition?.(); if (p && num(p.lat) && num(p.lng)) pos = { lat: p.lat, lng: p.lng }; } catch { /* ignore */ }
      remove([mk]); carMarker.current = null;
      if (pos) carMarker.current = marker(pos, ic, 1000);
    }
  };
  useCarGlide(
    car, ready,
    (f) => {
      if (!map.current) return;
      if (!carMarker.current) { carMarker.current = marker(f, carIcon(f.heading, false), 1000); carHeadingQ.current = Math.round(f.heading / 4) * 4; }
      else { try { carMarker.current.setPosition({ lat: f.lat, lng: f.lng }); } catch { /* ignore */ } setCarIcon(f.heading); }
      try { etaMarker.current?.setPosition?.({ lat: f.lat, lng: f.lng }); } catch { /* ignore */ }
    },
    () => {
      if (carMarker.current) remove([carMarker.current]); carMarker.current = null; carHeadingQ.current = -1;
      if (etaMarker.current) remove([etaMarker.current]); etaMarker.current = null; etaText.current = "";
    },
  );
  const eta = etaLabel(carEta);
  useEffect(() => {
    if (!map.current || !ready) return;
    if (!car || !eta) { if (etaMarker.current) remove([etaMarker.current]); etaMarker.current = null; etaText.current = ""; return; }
    if (eta === etaText.current && etaMarker.current) return;
    etaText.current = eta;
    if (etaMarker.current) remove([etaMarker.current]);
    let pos: LatLng = { lat: car.lat, lng: car.lng };
    try { const p = carMarker.current?.getPosition?.(); if (p && num(p.lat) && num(p.lng)) pos = { lat: p.lat, lng: p.lng }; } catch { /* ignore */ }
    etaMarker.current = marker(pos, etaChipIcon(eta, 52), 1001);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eta, !!car, ready]);
  useEffect(() => {
    if (!map.current || !ready || !follow || !car || !num(car.lat) || !num(car.lng)) return;
    easeTo({ lat: car.lat, lng: car.lng }, { duration: 900, offsetY: -(padRef.current.bottom - padRef.current.top) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.lat, car?.lng, follow, ready]);

  return (
    <div ref={holder} className={`relative overflow-hidden ${className || "h-64 w-full"}`}>
      {/* Inline geometry on purpose: the Mappls stylesheet adds `.mapboxgl-map { position: relative }`
          to this element once the map is created, which beats a utility class and collapses the
          canvas to the SDK's 150 px default. Inline styles always win. */}
      <div id={id} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} aria-label="Map" />
      <MapSkeleton visible={!ready && !failed} insetBottom={padBottom} insetTop={padTop} />
      {failed && <MapError onRetry={() => setAttempt((n) => n + 1)} detail={failed} insetBottom={padBottom} insetTop={padTop} />}
    </div>
  );
}

// "5 km" label for the discovery ring (bottom-anchored, floats just above the ring's top).
function kmLabelIcon(km: number): IconSpec {
  const text = `${km} km`;
  const bw = text.length * 7 + 16, bh = 22, w = bw + 4, h = bh + 10;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="2" y="2" width="${bw}" height="${bh}" rx="11" fill="${WHITE}" stroke="${PRIMARY}" stroke-width="1.5"/>` +
    `<text x="${w / 2}" y="${2 + bh / 2 + 4}" text-anchor="middle" font-family="DM Sans, system-ui, sans-serif" font-size="11" font-weight="700" fill="${PRIMARY}">${text}</text>` +
    `</svg>`;
  return { svg, width: w, height: h, url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg) };
}
