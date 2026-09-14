// Tiny class joiner — no runtime deps.
export type ClassValue = string | number | bigint | boolean | null | undefined | ClassValue[];
export function cn(...parts: ClassValue[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === true) continue;
    if (Array.isArray(p)) { const s = cn(...p); if (s) out.push(s); }
    else out.push(String(p));
  }
  return out.join(" ");
}
