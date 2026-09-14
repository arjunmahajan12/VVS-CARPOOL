// Leaflet / OpenStreetMap renderer — used ONLY in keyless demo builds. Renders
// the same MapProps as MapplsMap with the same icons and behaviours.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { num, VVS, type MapProps } from "./mapTypes";
import { ACCENT, PRIMARY, SLATE, WHITE, calloutIcon, carIcon, clusterIcon, etaChipIcon, etaLabel, pinIcon, stopIcon } from "./icons";
import { boundsOf, clusterPins, frameSignature, framePoints, padBoundsKm, safePath, type LatLng } from "./mapUtils";
import { useCarGlide } from "./useCarGlide";
import { MapSkeleton } from "./MapChrome";

const TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const divIcon = (svg: string, w: number, h: number, anchor: "bottom" | "center" = "bottom", cls = "") =>
  L.divIcon({ html: svg, className: `vvs-marker ${cls}`, iconSize: [w, h], iconAnchor: anchor === "bottom" ? [w / 2, h] : [w / 2, h / 2] });

export default function LeafletMap(props: MapProps) {
  const {
    center, zoom = 13, pins = [], stops = [], route, travelled, car, carEta, fences = [], radius, corridor,
    follow = false, cluster = false, padding, className,
  } = props;
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const shapes = useRef<L.LayerGroup | null>(null);   // route / corridor / travelled / radius / fences
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const stopLayer = useRef<L.LayerGroup | null>(null);
  const carMarker = useRef<L.Marker | null>(null);
  const etaMarker = useRef<L.Marker | null>(null);
  const etaText = useRef("");
  const fitSig = useRef("");
  const [ready, setReady] = useState(false);
  const [gen, setGen] = useState(0);        // bumps when the map (re)initialises
  const [zoomTick, setZoomTick] = useState(0);

  // latest callbacks without re-binding listeners
  const cb = useRef(props); cb.current = props;
  const padTop = padding?.top ?? 0, padBottom = padding?.bottom ?? 0;
  const padRef = useRef({ top: padTop, bottom: padBottom }); padRef.current = { top: padTop, bottom: padBottom };

  // ---- init (StrictMode-safe: cleanup fully removes the map, so the second mount re-creates it)
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const c0: [number, number] = num(center?.[0]) && num(center?.[1]) ? center : VVS;
    const m = L.map(el, { zoomControl: false, attributionControl: true, tap: false } as L.MapOptions).setView(c0, zoom);
    const tiles = L.tileLayer(TILES, { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
    shapes.current = L.layerGroup().addTo(m);
    pinLayer.current = L.layerGroup().addTo(m);
    stopLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    carMarker.current = null; etaMarker.current = null; etaText.current = ""; fitSig.current = "";
    let done = false;
    const markReady = () => { if (done) return; done = true; setReady(true); cb.current.onReady?.(); };
    tiles.on("load", markReady);
    const t = setTimeout(markReady, 1500);       // tiles blocked / slow: still show the layers
    m.on("click", (e: L.LeafletMouseEvent) => cb.current.onMapTap?.(e.latlng.lat, e.latlng.lng));
    m.on("zoomend", () => setZoomTick((n) => n + 1));
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el);
    const t2 = setTimeout(() => m.invalidateSize(), 60);
    setReady(false); setGen((g) => g + 1);
    return () => {
      clearTimeout(t); clearTimeout(t2); ro.disconnect();
      try { m.remove(); } catch { /* already gone */ }
      map.current = null; shapes.current = null; pinLayer.current = null; stopLayer.current = null;
      carMarker.current = null; etaMarker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- shapes: corridor, route, travelled, radius, fences
  const shapeKey = JSON.stringify([route, travelled, corridor, radius, fences]);
  useEffect(() => {
    const lg = shapes.current;
    if (!lg || !map.current) return;
    lg.clearLayers();
    const line = (p: LatLng[]) => p.map((q) => [q.lat, q.lng] as [number, number]);
    const cor = safePath(corridor);
    if (cor.length > 1) L.polyline(line(cor), { color: PRIMARY, weight: 22, opacity: 0.12, lineJoin: "round", lineCap: "round", interactive: false }).addTo(lg);
    for (const f of fences) {
      if (!num(f.lat) || !num(f.lng) || !num(f.radiusM)) continue;
      const tone = f.tone === "stop" ? ACCENT : SLATE;
      L.circle([f.lat, f.lng], { radius: f.radiusM, color: tone, weight: 1.5, opacity: 0.55, fillColor: tone, fillOpacity: f.tone === "stop" ? 0.1 : 0.05, interactive: false }).addTo(lg);
    }
    if (radius && num(radius.lat) && num(radius.lng) && num(radius.km)) {
      L.circle([radius.lat, radius.lng], { radius: radius.km * 1000, color: PRIMARY, weight: 1.5, opacity: 0.7, dashArray: "6 6", fillColor: PRIMARY, fillOpacity: 0.05, interactive: false }).addTo(lg);
      L.circleMarker([radius.lat, radius.lng], { radius: 5, color: WHITE, weight: 2, fillColor: PRIMARY, fillOpacity: 1, interactive: false }).addTo(lg);
      const top = radius.lat + radius.km / 111;
      const label = L.divIcon({ html: `<div class="vvs-km">${radius.km} km</div>`, className: "vvs-marker", iconSize: [0, 0], iconAnchor: [0, 0] });
      L.marker([top, radius.lng], { icon: label, interactive: false, keyboard: false }).addTo(lg);
    }
    const r = safePath(route);
    if (r.length > 1) {
      L.polyline(line(r), { color: WHITE, weight: 9, opacity: 0.95, lineJoin: "round", lineCap: "round", interactive: false }).addTo(lg);
      L.polyline(line(r), { color: PRIMARY, weight: 5, opacity: 0.95, lineJoin: "round", lineCap: "round", interactive: false }).addTo(lg);
    }
    const tr = safePath(travelled);
    if (tr.length > 1) {
      L.polyline(line(tr), { color: WHITE, weight: 9, opacity: 0.95, lineJoin: "round", lineCap: "round", interactive: false }).addTo(lg);
      L.polyline(line(tr), { color: "#94A3B8", weight: 5, opacity: 0.9, lineJoin: "round", lineCap: "round", interactive: false }).addTo(lg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, gen]);

  // ---- pins (+ clustering)
  const pinKey = JSON.stringify(pins);
  useEffect(() => {
    const lg = pinLayer.current, m = map.current;
    if (!lg || !m) return;
    lg.clearLayers();
    for (const cell of clusterPins(pins, m.getZoom(), cluster)) {
      if (cell.type === "cluster") {
        const ic = clusterIcon(cell.count);
        const mk = L.marker([cell.lat, cell.lng], { icon: divIcon(ic.svg, ic.width, ic.height, "bottom", "vvs-cluster"), keyboard: false, riseOnHover: true }).addTo(lg);
        mk.on("click", () => m.setView([cell.lat, cell.lng], Math.min(18, m.getZoom() + 2), { animate: true }));
        continue;
      }
      const p = cell.pin;
      const ic = pinIcon(p.kind, !!p.selected);
      const mk = L.marker([p.lat, p.lng], {
        icon: divIcon(ic.svg, ic.width, ic.height, "bottom", p.selected ? "vvs-pin vvs-pin-selected" : "vvs-pin"),
        zIndexOffset: p.selected ? 500 : p.kind === "school" ? 200 : 0, title: p.label, riseOnHover: true,
      }).addTo(lg);
      mk.on("click", () => cb.current.onPinTap?.(p.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey, cluster, zoomTick, gen]);

  // ---- stops (+ next-stop callout)
  const stopKey = JSON.stringify(stops);
  useEffect(() => {
    const lg = stopLayer.current, m = map.current;
    if (!lg || !m) return;
    lg.clearLayers();
    for (const s of stops) {
      if (!num(s.lat) || !num(s.lng)) continue;
      const big = s.kind === "school" || !!s.isNext;
      const ic = stopIcon(s.seq, s.status, !!s.isNext, big);
      const mk = L.marker([s.lat, s.lng], {
        icon: divIcon(ic.svg, ic.width, ic.height, "bottom", `vvs-stop vvs-stop-${s.status}`),
        zIndexOffset: s.isNext ? 600 : s.status === "stopped" ? 400 : 0, title: s.label, riseOnHover: true,
      }).addTo(lg);
      mk.on("click", () => cb.current.onStopTap?.(s.id));
      if (s.isNext) {
        const co = calloutIcon(s.label, s.etaMin, ic.height + 2);
        const icon = L.divIcon({ html: co.svg, className: "vvs-marker vvs-callout", iconSize: [co.width, co.height], iconAnchor: [co.width / 2, co.height] });
        L.marker([s.lat, s.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 700 }).addTo(lg);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey, gen]);

  // ---- fit bounds on first meaningful data (and when the framed SET changes); never while following
  const sig = frameSignature({ stops, pins, route, radius });
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (follow || sig === fitSig.current) return;
    const { points, padKm } = framePoints({ stops, pins, route, radius, car });
    if (!points.length) return;
    fitSig.current = sig;
    let b = boundsOf(points); if (!b) return;
    if (padKm) b = padBoundsKm(b, padKm);
    const single = points.length === 1 && !padKm;
    try {
      if (single) {
        // a lone point (picker pin, one family): only move if it isn't already comfortably on screen
        const ll = L.latLng(b.south, b.west);
        const visible = m.getZoom() >= 13 && m.getBounds().contains(ll) && m.latLngToContainerPoint(ll).y < m.getSize().y - padRef.current.bottom - 40;
        if (!visible) m.setView(ll, Math.max(m.getZoom(), 15), { animate: false });
      }
      else m.fitBounds(L.latLngBounds([b.south, b.west], [b.north, b.east]), {
        paddingTopLeft: [28, 28 + padRef.current.top], paddingBottomRight: [28, 28 + padRef.current.bottom], maxZoom: 16, animate: false,
      });
    } catch { /* container not laid out yet */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready, follow, gen]);

  // ---- car: glide + heading + eta chip + follow
  const ensureCar = (m: L.Map, f: LatLng) => {
    if (carMarker.current) return carMarker.current;
    const ic = carIcon(0, true);
    const icon = L.divIcon({ html: `<div class="vvs-car-rot" style="width:${ic.width}px;height:${ic.height}px">${ic.svg}</div>`, className: "vvs-marker vvs-car", iconSize: [ic.width, ic.height], iconAnchor: [ic.width / 2, ic.height / 2] });
    carMarker.current = L.marker([f.lat, f.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(m);
    return carMarker.current;
  };
  useCarGlide(
    car, ready,
    (f) => {
      const m = map.current; if (!m) return;
      const mk = ensureCar(m, f);
      mk.setLatLng([f.lat, f.lng]);
      const rot = mk.getElement()?.querySelector<HTMLElement>(".vvs-car-rot");
      if (rot) rot.style.transform = `rotate(${f.heading.toFixed(1)}deg)`;
      etaMarker.current?.setLatLng([f.lat, f.lng]);
    },
    () => {
      carMarker.current?.remove(); carMarker.current = null;
      etaMarker.current?.remove(); etaMarker.current = null; etaText.current = "";
    },
  );
  // ETA chip content
  const eta = etaLabel(carEta);
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    if (!car || !eta) { etaMarker.current?.remove(); etaMarker.current = null; etaText.current = ""; return; }
    if (eta === etaText.current && etaMarker.current) return;
    etaText.current = eta;
    const ic = etaChipIcon(eta, 30);
    const icon = L.divIcon({ html: ic.svg, className: "vvs-marker vvs-eta", iconSize: [ic.width, ic.height], iconAnchor: [ic.width / 2, ic.height] });
    const at = carMarker.current?.getLatLng() ?? L.latLng(car.lat, car.lng);
    if (etaMarker.current) etaMarker.current.setIcon(icon);
    else etaMarker.current = L.marker(at, { icon, interactive: false, keyboard: false, zIndexOffset: 1001 }).addTo(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eta, !!car, ready, gen]);
  // Follow: ease the camera to each new ping, keeping the car centred in the area above the sheet.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !follow || !car || !num(car.lat) || !num(car.lng)) return;
    try {
      const z = m.getZoom();
      const p = m.project([car.lat, car.lng], z);
      const shifted = m.unproject(L.point(p.x, p.y + (padRef.current.bottom - padRef.current.top) / 2), z);
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      m.panTo(shifted, { animate: !reduce, duration: 0.9, easeLinearity: 0.4, noMoveStart: true });
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.lat, car?.lng, follow, ready, gen]);

  return (
    <div className={`relative overflow-hidden ${className || "h-64 w-full"}`}>
      <div ref={holder} className="absolute inset-0 z-0" aria-label="Map" />
      <MapSkeleton visible={!ready} insetBottom={padBottom} insetTop={padTop} />
      <style>{`
        .vvs-marker { background: none; border: 0; }
        .vvs-marker svg { display: block; overflow: visible; }
        .vvs-pin, .vvs-stop, .vvs-cluster { cursor: pointer; transition: transform .18s ease; transform-origin: 50% 100%; }
        .vvs-pin:hover, .vvs-stop:hover, .vvs-cluster:hover { transform: scale(1.06); }
        .vvs-car-rot { transition: transform .25s ease-out; transform-origin: 50% 50%; will-change: transform; }
        .vvs-stop-stopped svg { animation: vvs-pulse 1.4s ease-in-out infinite; transform-origin: 50% 100%; }
        .vvs-km { display: inline-block; width: max-content; transform: translate(-50%, -100%); margin-top: -6px; white-space: nowrap; font: 700 11px/1 DM Sans, system-ui, sans-serif; color: ${PRIMARY}; background: #fff; border: 1.5px solid ${PRIMARY}; border-radius: 999px; padding: 4px 8px; box-shadow: 0 2px 8px -2px rgba(17,26,46,.25); }
        @keyframes vvs-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @media (prefers-reduced-motion: reduce) { .vvs-stop-stopped svg, .vvs-car-rot, .vvs-pin { animation: none; transition: none; } }
        .leaflet-container { font-family: DM Sans, system-ui, sans-serif; background: #E6EBF3; }
        .dark .leaflet-container { background: #0F172A; }
        .dark .leaflet-tile { filter: brightness(.72) contrast(1.05) saturate(.8); }
        .leaflet-control-attribution { font-size: 9px; opacity: .7; }
      `}</style>
    </div>
  );
}
