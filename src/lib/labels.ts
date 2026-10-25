import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Label PDFs are sized exactly to the roll, then printed from the MUNBYN app (iPhone: share → MUNBYN)
// or the desktop driver at 100 % scale.
const MM = 72 / 25.4;

export type LabelFormat = "57x32" | "50x30" | "4x6";

export const LABEL_FORMATS: Record<LabelFormat, { w: number; h: number; name: string }> = {
  "57x32": { w: 57, h: 32, name: "Article 57 × 32 mm" },
  "50x30": { w: 50, h: 30, name: "Article 50 × 30 mm" },
  "4x6": { w: 101.6, h: 152.4, name: "4 × 6 pouces (4 étiquettes à découper)" },
};

export interface ItemLabel {
  sku: string;
  line?: string; // e.g. "Hugo Boss · T50"
}

async function barcode(text: string, kind: "code128" | "qrcode") {
  return bwipjs.toBuffer(
    kind === "code128"
      ? { bcid: "code128", text, scale: 4, height: 12, includetext: false }
      : { bcid: "qrcode", text, scale: 6 },
  );
}

function fitText(font: PDFFont, text: string, maxWidth: number, size: number) {
  while (size > 5 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

async function drawItemLabel(pdf: PDFDocument, page: PDFPage, x: number, y: number, w: number, h: number, label: ItemLabel, orgName: string) {
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const pad = 2 * MM;
  const png = await pdf.embedPng(await barcode(label.sku, "code128"));
  const bcH = h * 0.42;
  page.drawImage(png, { x: x + pad, y: y + h - pad - bcH, width: w - 2 * pad, height: bcH });
  const skuSize = fitText(bold, label.sku, w - 2 * pad, 18);
  page.drawText(label.sku, {
    x: x + (w - bold.widthOfTextAtSize(label.sku, skuSize)) / 2,
    y: y + h - pad - bcH - skuSize - 1,
    size: skuSize,
    font: bold,
  });
  const footer = label.line ? `${label.line} · ${orgName}` : orgName;
  const fSize = fitText(regular, footer, w - 2 * pad, 7);
  page.drawText(footer, { x: x + (w - regular.widthOfTextAtSize(footer, fSize)) / 2, y: y + pad, size: fSize, font: regular });
}

export async function itemLabelsPdf(labels: ItemLabel[], format: LabelFormat, orgName: string) {
  const pdf = await PDFDocument.create();
  const { w, h } = LABEL_FORMATS[format];
  if (format === "4x6") {
    // 4 labels of 50.8 × 76.2 mm per sheet, with cut lines
    const cw = (w / 2) * MM, ch = (h / 2) * MM;
    for (let i = 0; i < labels.length; i += 4) {
      const page = pdf.addPage([w * MM, h * MM]);
      page.drawLine({ start: { x: cw, y: 0 }, end: { x: cw, y: h * MM }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6), dashArray: [3, 3] });
      page.drawLine({ start: { x: 0, y: ch }, end: { x: w * MM, y: ch }, thickness: 0.3, color: rgb(0.6, 0.6, 0.6), dashArray: [3, 3] });
      for (let j = 0; j < 4 && i + j < labels.length; j++) {
        const col = j % 2, row = 1 - Math.floor(j / 2);
        // label centred in its quarter, landscape-like proportions for the barcode
        await drawItemLabel(pdf, page, col * cw + 2 * MM, row * ch + ch / 2 - 16 * MM, cw - 4 * MM, 32 * MM, labels[i + j], orgName);
      }
    }
  } else {
    for (const label of labels) {
      const page = pdf.addPage([w * MM, h * MM]);
      await drawItemLabel(pdf, page, 0, 0, w * MM, h * MM, label, orgName);
    }
  }
  return pdf.save();
}

/** Shelf/bin labels: one per 4×6 sheet, big code + QR, readable from a distance */
export async function locationLabelsPdf(codes: string[]) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 101.6 * MM, H = 152.4 * MM, pad = 6 * MM;
  for (const code of codes) {
    const page = pdf.addPage([W, H]);
    const qr = await pdf.embedPng(await barcode(code, "qrcode"));
    const qrSize = W - 2 * pad - 20 * MM;
    page.drawImage(qr, { x: (W - qrSize) / 2, y: H - pad - qrSize, width: qrSize, height: qrSize });
    const short = code.replace(/^EMP-/, "");
    const size = fitText(bold, short, W - 2 * pad, 64);
    page.drawText(short, { x: (W - bold.widthOfTextAtSize(short, size)) / 2, y: H - pad - qrSize - size - 4 * MM, size, font: bold });
    const bc = await pdf.embedPng(await barcode(code, "code128"));
    page.drawImage(bc, { x: pad, y: pad, width: W - 2 * pad, height: 22 * MM });
  }
  return pdf.save();
}
