// Vinted shipping labels (bordereaux) on the MUNBYN 4 × 6 roll. Vinted hands out an A4 PDF (or a screenshot) with the
// label somewhere on the page: the chosen zone is cut out, turned if it is wider than tall, and scaled to fill a
// 102 × 152 mm page without distortion. Everything happens in the browser; the file never leaves the device.

import {
  PDFDocument, clip as clipOp, degrees, endPath, popGraphicsState, pushGraphicsState, rectangle,
  type PDFEmbeddedPage, type PDFImage,
} from "pdf-lib";

const MM = 72 / 25.4;
export const ROLL = { w: 101.6 * MM, h: 152.4 * MM };
/** White border kept around the label, in points (≈ 2 mm: the printer cannot print to the very edge) */
const MARGIN = 2 * MM;

/** Part of the source page to keep, as fractions of its width and height from the top-left corner */
export interface Zone { x: number; y: number; w: number; h: number }
export const ZONES = {
  page: { name: "Page entière", zone: { x: 0, y: 0, w: 1, h: 1 } },
  top: { name: "Moitié haute", zone: { x: 0, y: 0, w: 1, h: 0.5 } },
  bottom: { name: "Moitié basse", zone: { x: 0, y: 0.5, w: 1, h: 0.5 } },
  topLeft: { name: "Quart haut gauche", zone: { x: 0, y: 0, w: 0.5, h: 0.5 } },
  topRight: { name: "Quart haut droit", zone: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
  bottomLeft: { name: "Quart bas gauche", zone: { x: 0, y: 0.5, w: 0.5, h: 0.5 } },
  bottomRight: { name: "Quart bas droit", zone: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
} satisfies Record<string, { name: string; zone: Zone }>;
export type ZoneKey = keyof typeof ZONES;
export const isZoneKey = (v: unknown): v is ZoneKey => typeof v === "string" && v in ZONES;

/** Where the cut-out lands on the roll page: turned a quarter when that makes it bigger, centred, aspect kept */
export function placement(srcW: number, srcH: number) {
  const boxW = ROLL.w - 2 * MARGIN, boxH = ROLL.h - 2 * MARGIN;
  const straight = Math.min(boxW / srcW, boxH / srcH);
  const turned = Math.min(boxW / srcH, boxH / srcW);
  const rotate = turned > straight * 1.001;
  const scale = rotate ? turned : straight;
  const w = (rotate ? srcH : srcW) * scale, h = (rotate ? srcW : srcH) * scale; // size on the roll
  return { rotate, scale, w, h, x: (ROLL.w - w) / 2, y: (ROLL.h - h) / 2 };
}

export type LabelSource = { kind: "pdf" | "png" | "jpg"; bytes: Uint8Array | ArrayBuffer };

export function sourceKind(file: { name: string; type: string }): LabelSource["kind"] | null {
  const t = file.type.toLowerCase(), n = file.name.toLowerCase();
  if (t === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (t === "image/png" || n.endsWith(".png")) return "png";
  if (t === "image/jpeg" || /\.jpe?g$/.test(n)) return "jpg";
  return null;
}

/**
 * One roll page per source page (a PDF with several labels gives several pages), cut to `zone`.
 * Images are embedded as they are; PDF pages stay vector, so barcodes print sharp.
 */
export async function fitLabel(src: LabelSource, zone: Zone): Promise<{ pdf: Uint8Array; pages: number }> {
  const out = await PDFDocument.create();
  out.setTitle("Bordereau d'expédition");
  out.setProducer("Lefort OS");

  const draw = (item: PDFEmbeddedPage | PDFImage, fullW: number, fullH: number, isImage: boolean) => {
    const cw = fullW * zone.w, ch = fullH * zone.h;
    const p = placement(cw, ch);
    const page = out.addPage([ROLL.w, ROLL.h]);
    // The whole source is drawn at the scale of the zone, shifted so that the zone falls in the box; what lies outside
    // is clipped away by the rectangle below.
    const left = fullW * zone.x, bottom = fullH * (1 - zone.y - zone.h); // zone corner in PDF units (origin bottom-left)
    page.pushOperators(...clip(p.x, p.y, p.w, p.h));
    // Turned a quarter clockwise, a source point (u, v) lands at (x + v·s, y − u·s): the zone's top goes to the right.
    const opts = p.rotate
      ? { x: p.x - bottom * p.scale, y: p.y + p.h + left * p.scale, rotate: degrees(-90) }
      : { x: p.x - left * p.scale, y: p.y - bottom * p.scale, rotate: degrees(0) };
    const size = { width: fullW * p.scale, height: fullH * p.scale };
    if (isImage) page.drawImage(item as PDFImage, { ...opts, ...size });
    else page.drawPage(item as PDFEmbeddedPage, { ...opts, xScale: p.scale, yScale: p.scale });
    page.pushOperators(...restore());
  };

  if (src.kind === "pdf") {
    const doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
    const pages = await out.embedPages(doc.getPages());
    pages.forEach((e) => draw(e, e.width, e.height, false));
  } else {
    const img = src.kind === "png" ? await out.embedPng(src.bytes) : await out.embedJpg(src.bytes);
    draw(img, img.width, img.height, true);
  }
  return { pdf: await out.save(), pages: out.getPageCount() };
}

// q · re W n … Q : keep only what is drawn inside the rectangle
const clip = (x: number, y: number, w: number, h: number) => [pushGraphicsState(), rectangle(x, y, w, h), clipOp(), endPath()];
const restore = () => [popGraphicsState()];
