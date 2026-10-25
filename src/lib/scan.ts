// Barcode payloads are typed by prefix so one scanner can drive every screen.
export type ScanKind = "item" | "location" | "batch" | "command" | "unknown";

export interface ScanResult {
  kind: ScanKind;
  code: string;
}

export function classifyScan(raw: string): ScanResult {
  const code = raw.trim().toUpperCase();
  if (/^EMP-[A-Z0-9-]+$/.test(code)) return { kind: "location", code };
  if (/^LOT-[A-Z0-9-]+$/.test(code)) return { kind: "batch", code };
  if (/^CMD-[A-Z]+$/.test(code)) return { kind: "command", code };
  if (/^[A-Z]{2,5}\d{5,}$/.test(code)) return { kind: "item", code };
  return { kind: "unknown", code };
}

/** Builds a Vinted item id from a listing URL (vinted.fr/items/123456-slug) */
export function vintedIdFromUrl(url: string): string | null {
  return url.match(/vinted\.[a-z.]+\/items\/(\d+)/i)?.[1] ?? null;
}
