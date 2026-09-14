// Inline SVG builders shared by the Mappls and Leaflet maps.
//
// CRITICAL: Mappls injects icon data-URLs into CSS `url(...)`, and
// encodeURIComponent leaves "(" and ")" raw — a single parenthesis (rgba(),
// rotate(), translate()) closes the url() early and the icon silently
// vanishes. So NOTHING in these strings may contain a parenthesis: colours are
// hex + fill-opacity, rotation is baked into path coordinates, and user text is
// scrubbed by `esc()`.
//
// All icons are drawn to be BOTTOM-CENTRE anchored (the point of interest is
// the middle of the bottom edge) so both providers can place them the same way.
import type { StopStatus } from "../../lib/types";
import { PIN_TONE, STOP_TONE, type MapPin } from "./mapTypes";

export const PRIMARY = "#1F4B99";
export const PRIMARY_DARK = "#173B7A";
export const ACCENT = "#F2A900";
export const INK = "#111A2E";
export const INK_950 = "#0B1220";
export const SLATE = "#64748B";
export const SLATE_300 = "#CBD5E1";
export const WHITE = "#FFFFFF";
const FONT = "DM Sans, system-ui, -apple-system, Segoe UI, sans-serif";

// Scrub text destined for an SVG: no parens, no quotes, escape XML.
export function esc(s: string): string {
  return String(s ?? "")
    .replace(/[()'"`]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function dataUrl(svg: string): string {
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
// Approximate rendered width of bold ~12px text (for chip sizing).
export function textWidth(s: string, px: number): number {
  return Math.ceil(s.length * px * 0.62);
}

export interface IconSpec { svg: string; width: number; height: number; url: string }
const spec = (svg: string, width: number, height: number): IconSpec => ({ svg, width, height, url: dataUrl(svg) });

// ---------------------------------------------------------------- pins
// Teardrop pin with a glyph per kind. `selected` = larger with a soft ring.
const GLYPH: Record<MapPin["kind"], string> = {
  // school: tiny building; home: roof; family: person; carpool: car — all as simple paths
  school: `<path d="M8 15V10L13 7L18 10V15Z M11 15V12H15V15Z" fill="#FFFFFF"/>`,
  home:   `<path d="M13 7L19 12.5H17.5V17H14.5V14H11.5V17H8.5V12.5H7Z" fill="#FFFFFF"/>`,
  family: `<circle cx="13" cy="10.2" r="2.4" fill="#FFFFFF"/><path d="M8.5 17C8.5 14.2 10.5 13 13 13C15.5 13 17.5 14.2 17.5 17Z" fill="#FFFFFF"/>`,
  carpool:`<path d="M8 14.5L9.2 10.8C9.4 10.2 9.9 9.8 10.5 9.8H15.5C16.1 9.8 16.6 10.2 16.8 10.8L18 14.5V17H16.5V15.8H9.5V17H8Z" fill="#FFFFFF"/><circle cx="10.4" cy="14.1" r="0.9" fill="${PIN_TONE.carpool}"/><circle cx="15.6" cy="14.1" r="0.9" fill="${PIN_TONE.carpool}"/>`,
};
export function pinIcon(kind: MapPin["kind"], selected = false): IconSpec {
  const fill = PIN_TONE[kind];
  const s = selected ? 1.3 : 1;
  const w = Math.round(34 * s), h = Math.round(42 * s);
  const ring = selected ? `<circle cx="17" cy="17.5" r="16.5" fill="${fill}" fill-opacity="0.22"/>` : "";
  // Glyphs are authored in a 26x26 space centred at 13,12; a nested <svg x y>
  // positions them on the pin head (no transform="translate()" — parens!).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 34 42">` +
    ring +
    `<path d="M17 40.5C17 40.5 28 26.5 28 17.5A11 11 0 1 0 6 17.5C6 26.5 17 40.5 17 40.5Z" fill="${fill}" stroke="${WHITE}" stroke-width="2"/>` +
    `<svg x="4" y="5.5" width="26" height="26" viewBox="0 0 26 26">${GLYPH[kind]}</svg>` +
    `</svg>`;
  return spec(svg, w, h);
}

// Cluster bubble: count badge, bottom-anchored like a pin.
export function clusterIcon(count: number): IconSpec {
  const d = count >= 100 ? 46 : count >= 10 ? 42 : 38;
  const w = d + 10, h = d + 10;
  const cx = w / 2, cy = d / 2 + 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<circle cx="${cx}" cy="${cy}" r="${d / 2 + 4}" fill="${PIN_TONE.family}" fill-opacity="0.18"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="${PIN_TONE.family}" stroke="${WHITE}" stroke-width="2.5"/>` +
    `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="${WHITE}">${count}</text>` +
    `</svg>`;
  return spec(svg, w, h);
}

// ---------------------------------------------------------------- stops
// Numbered badge on a short stalk. done → check, missed → "!", skipped → dashed/faded.
export function stopIcon(seq: number, status: StopStatus, isNext = false, big = false): IconSpec {
  const t = STOP_TONE[status];
  const r = big ? 15 : 13;
  const w = r * 2 + 12, h = r * 2 + 18;
  const cx = w / 2, cy = r + 4;
  const faded = status === "skipped";
  const dash = faded ? ` stroke-dasharray="3 2.5"` : "";
  const ringR = r + 4;
  const nextRing = isNext ? `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="${t.fill}" fill-opacity="0.2"/>` : "";
  const stalk = `<path d="M${cx} ${cy + r - 1}L${cx} ${h - 2}" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M${cx} ${cy + r - 1}L${cx} ${h - 2}" stroke="${t.fill}" stroke-width="2" stroke-linecap="round" stroke-opacity="${faded ? 0.5 : 1}"/>` +
    `<circle cx="${cx}" cy="${h - 3}" r="2.6" fill="${WHITE}"/><circle cx="${cx}" cy="${h - 3}" r="1.5" fill="${t.fill}"/>`;
  let glyph: string;
  if (status === "done") {
    glyph = `<path d="M${cx - 6} ${cy}L${cx - 1.5} ${cy + 4.5}L${cx + 6.5} ${cy - 4.5}" fill="none" stroke="${t.text}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (status === "missed") {
    glyph = `<text x="${cx}" y="${cy + 5.5}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="${t.text}">!</text>`;
  } else {
    glyph = `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="${FONT}" font-size="${seq >= 10 ? 12 : 14}" font-weight="700" fill="${t.text}">${seq}</text>`;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    nextRing + stalk +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${t.fill}" fill-opacity="${faded ? 0.55 : 1}" stroke="${WHITE}" stroke-width="2.5"${dash}/>` +
    glyph + `</svg>`;
  return spec(svg, w, h);
}

// Callout label drawn above the next stop: "Label · ~4 min". Bottom-anchored, the
// bubble floats clear of the stop badge (offset baked into the SVG height).
export function calloutIcon(label: string, etaMin: number | null | undefined, lift = 48, tone = STOP_TONE.arriving.fill): IconSpec {
  const text = esc(label.length > 22 ? label.slice(0, 21) + "…" : label);
  const eta = etaMin != null && Number.isFinite(etaMin) ? `~${Math.max(1, Math.round(etaMin))} min` : "";
  const padX = 12, gap = eta ? 8 : 0;
  const tw = textWidth(text, 12.5), ew = eta ? textWidth(eta, 12) + 12 : 0;
  const bw = padX * 2 + tw + gap + ew, bh = 30;
  // `lift` = transparent space between the tail tip and the anchor point (clears the badge)
  const w = Math.max(bw + 8, 60), h = bh + 8 + lift;
  const x0 = (w - bw) / 2, y0 = 3;
  const tail = `<path d="M${w / 2 - 6} ${y0 + bh}L${w / 2} ${y0 + bh + 7}L${w / 2 + 6} ${y0 + bh}Z" fill="${INK_950}"/>`;
  const etaChip = eta
    ? `<rect x="${x0 + padX + tw + gap}" y="${y0 + 6}" width="${ew}" height="${bh - 12}" rx="9" fill="${tone}"/>` +
      `<text x="${x0 + padX + tw + gap + ew / 2}" y="${y0 + bh / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${INK_950}">${eta}</text>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" rx="15" fill="${INK_950}" stroke="${WHITE}" stroke-width="1.5"/>` +
    tail +
    `<text x="${x0 + padX}" y="${y0 + bh / 2 + 4.5}" font-family="${FONT}" font-size="12.5" font-weight="600" fill="${WHITE}">${text}</text>` +
    etaChip + `</svg>`;
  return spec(svg, w, h);
}

// ---------------------------------------------------------------- car
// Heading-rotated puck with a soft halo. Rotation is baked into the arrow path
// (no transform="rotate()" — parens!). `centred` = the puck is centred in the
// box (Leaflet, which can anchor at the centre); otherwise bottom-anchored.
export function carIcon(headingDeg: number | null | undefined, centred = true): IconSpec {
  const size = 44, cx = size / 2, cy = size / 2;
  const h = centred ? size : size + cy; // bottom-anchored version adds space below so the puck sits ON the point
  const rot = ((headingDeg ?? 0) * Math.PI) / 180;
  const pt = (x: number, y: number) => {
    const rx = x * Math.cos(rot) - y * Math.sin(rot), ry = x * Math.sin(rot) + y * Math.cos(rot);
    return `${(cx + rx).toFixed(2)} ${(cy + ry).toFixed(2)}`;
  };
  const arrow = `M${pt(0, -9)}L${pt(6.5, 6.5)}L${pt(0, 3.2)}L${pt(-6.5, 6.5)}Z`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 ${size} ${h}">` +
    `<circle cx="${cx}" cy="${cy}" r="21" fill="${PRIMARY}" fill-opacity="0.14"/>` +
    `<circle cx="${cx}" cy="${cy}" r="15" fill="${PRIMARY}" fill-opacity="0.22"/>` +
    `<circle cx="${cx}" cy="${cy}" r="11.5" fill="${PRIMARY}" stroke="${WHITE}" stroke-width="2.5"/>` +
    `<path d="${arrow}" fill="${WHITE}" stroke="${WHITE}" stroke-width="0.8" stroke-linejoin="round"/>` +
    `</svg>`;
  return spec(svg, size, h);
}

// ETA chip that rides beside the car ("4 min"). Marigold — the live accent.
export function etaChipIcon(label: string, lift = 34): IconSpec {
  const text = esc(label);
  const tw = textWidth(text, 13), bw = tw + 22, bh = 28;
  const w = bw + 6, h = bh + 6 + lift;
  const x0 = 3, y0 = 3;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" rx="14" fill="${ACCENT}" stroke="${WHITE}" stroke-width="2"/>` +
    `<text x="${x0 + bw / 2}" y="${y0 + bh / 2 + 4.5}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="${INK_950}">${text}</text>` +
    `</svg>`;
  return spec(svg, w, h);
}

// Picker pin (LocationPicker) — a bigger home pin with a shadow disc.
export function pickerPinIcon(): IconSpec {
  const w = 44, h = 54;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 44 54">` +
    `<ellipse cx="22" cy="51" rx="9" ry="3" fill="${INK_950}" fill-opacity="0.25"/>` +
    `<path d="M22 50C22 50 36 31 36 21A14 14 0 1 0 8 21C8 31 22 50 22 50Z" fill="${ACCENT}" stroke="${WHITE}" stroke-width="2.5"/>` +
    `<path d="M22 12L31 20.5H28.5V28H24V22.5H20V28H15.5V20.5H13Z" fill="${INK_950}"/>` +
    `</svg>`;
  return spec(svg, w, h);
}

export const etaLabel = (min: number | null | undefined): string =>
  min != null && Number.isFinite(min) ? `${Math.max(1, Math.round(min))} min` : "";
