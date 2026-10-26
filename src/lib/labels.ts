import "server-only";
import bwipjs from "bwip-js/node";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Label PDFs are sized exactly to the roll, then printed from the MUNBYN app (iPhone: share → MUNBYN)
// or the desktop driver at 100 % scale.
const MM = 72 / 25.4;

export type LabelFormat = "57x32" | "50x30" | "4x6" | "4x6-max" | "4x6-qr";

export const LABEL_FORMATS: Record<LabelFormat, { w: number; h: number; name: string }> = {
  "57x32": { w: 57, h: 32, name: "Article 57 × 32 mm" },
  "50x30": { w: 50, h: 30, name: "Article 50 × 30 mm" },
  "4x6": { w: 101.6, h: 152.4, name: "4 × 6 pouces (4 étiquettes à découper)" },
  "4x6-max": { w: 101.6, h: 152.4, name: "102 × 152 mm, maximum d'étiquettes (code-barres)" },
  "4x6-qr": { w: 101.6, h: 152.4, name: "102 × 152 mm, maximum d'étiquettes (QR)" },
};

// ── Dense sheets ────────────────────────────────────────────────
// Thermal printers are 203 dpi: one dot = 0.125 mm. Bars of 2 dots (0.25 mm) and QR modules of 3 dots
// (0.375 mm) are the smallest that still print sharply and scan reliably. Codes are drawn as vector
// rectangles (no image resampling), and keep their quiet zones.
const BAR_MODULE = 0.25;
const QR_MODULE = 0.375;
const SHEET_MARGIN = 2;

function code128Bars(text: string): number[] {
  return (bwipjs.raw("code128", text, {}) as unknown as { sbs: number[] }[])[0].sbs; // bar, space, bar, … widths in modules
}
function qrMatrix(text: string): { size: number; on: (x: number, y: number) => boolean } {
  const r = (bwipjs.raw("qrcode", text, {}) as unknown as { pixs: number[]; pixx: number }[])[0];
  return { size: r.pixx, on: (x, y) => r.pixs[y * r.pixx + x] === 1 };
}

/** Lays cells out on 4×6 sheets: as many columns and rows as fit, cells spread evenly, dotted cut lines */
function sheetGrid(cellW: number, cellH: number) {
  const W = 101.6, H = 152.4;
  const cols = Math.max(1, Math.floor((W - 2 * SHEET_MARGIN) / cellW));
  const rows = Math.max(1, Math.floor((H - 2 * SHEET_MARGIN) / cellH));
  return { W, H, cols, rows, cw: (W - 2 * SHEET_MARGIN) / cols, ch: (H - 2 * SHEET_MARGIN) / rows };
}

/** Dotted cut lines around the cells actually used (`count` labels on this sheet) */
function cutLines(page: PDFPage, g: ReturnType<typeof sheetGrid>, count: number) {
  const line = { thickness: 0.25, color: rgb(0.55, 0.55, 0.55), dashArray: [1.5, 2.5] };
  const usedRows = Math.ceil(count / g.cols);
  const bottom = g.H - SHEET_MARGIN - usedRows * g.ch;
  for (let c = 1; c < Math.min(g.cols, count); c++) {
    const x = (SHEET_MARGIN + c * g.cw) * MM;
    page.drawLine({ start: { x, y: bottom * MM }, end: { x, y: (g.H - SHEET_MARGIN) * MM }, ...line });
  }
  for (let r = 1; r <= Math.min(usedRows, g.rows - 1); r++) {
    const y = (g.H - SHEET_MARGIN - r * g.ch) * MM; // rows are laid out from the top
    page.drawLine({ start: { x: SHEET_MARGIN * MM, y }, end: { x: (g.W - SHEET_MARGIN) * MM, y }, ...line });
  }
}

async function denseBarcodeSheets(pdf: PDFDocument, labels: ItemLabel[]) {
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bars = labels.map((l) => code128Bars(l.sku));
  const widest = Math.max(...bars.map((b) => b.reduce((a, c) => a + c, 0))) * BAR_MODULE;
  // quiet zone of 8 modules on each side of the bars (neighbours add theirs after cutting)
  const QUIET = 2, BAR_H = 7, SKU_PT = 7.5, LINE_PT = 5.5;
  const g = sheetGrid(widest + 2 * QUIET, 1.2 + BAR_H + 3.2 + (labels.some((l) => l.line) ? 2.4 : 0) + 0.8);
  const perSheet = g.cols * g.rows;
  for (let i = 0; i < labels.length; i += perSheet) {
    const page = pdf.addPage([g.W * MM, g.H * MM]);
    cutLines(page, g, Math.min(perSheet, labels.length - i));
    labels.slice(i, i + perSheet).forEach((label, j) => {
      const col = j % g.cols, row = Math.floor(j / g.cols);
      const left = SHEET_MARGIN + col * g.cw, top = g.H - SHEET_MARGIN - row * g.ch;
      const sbs = bars[i + j];
      const width = sbs.reduce((a, c) => a + c, 0) * BAR_MODULE;
      let x = left + (g.cw - width) / 2;
      const yBar = top - 1.2 - BAR_H;
      sbs.forEach((m, k) => {
        if (k % 2 === 0) page.drawRectangle({ x: x * MM, y: yBar * MM, width: m * BAR_MODULE * MM, height: BAR_H * MM, color: rgb(0, 0, 0) });
        x += m * BAR_MODULE;
      });
      const cx = (left + g.cw / 2) * MM;
      const skuSize = fitText(bold, label.sku, (g.cw - 1) * MM, SKU_PT);
      page.drawText(label.sku, { x: cx - bold.widthOfTextAtSize(label.sku, skuSize) / 2, y: (yBar - 3) * MM, size: skuSize, font: bold });
      if (label.line) {
        const l = fitLine(regular, label.line, (g.cw - 1) * MM, LINE_PT);
        page.drawText(l.text, { x: cx - regular.widthOfTextAtSize(l.text, l.size) / 2, y: (yBar - 5.3) * MM, size: l.size, font: regular });
      }
    });
  }
}

async function denseQrSheets(pdf: PDFDocument, labels: ItemLabel[]) {
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const codes = labels.map((l) => qrMatrix(l.sku));
  const QUIET = 2 * QR_MODULE, SKU_PT = 6.5, LINE_PT = 5;
  const qr = Math.max(...codes.map((c) => c.size)) * QR_MODULE;
  const textW = Math.max(...labels.map((l) => bold.widthOfTextAtSize(l.sku, SKU_PT))) / MM;
  const g = sheetGrid(Math.max(qr + 2 * QUIET, textW + 1) + 1, qr + 2 * QUIET + 2.6 + (labels.some((l) => l.line) ? 2 : 0) + 0.6);
  const perSheet = g.cols * g.rows;
  for (let i = 0; i < labels.length; i += perSheet) {
    const page = pdf.addPage([g.W * MM, g.H * MM]);
    cutLines(page, g, Math.min(perSheet, labels.length - i));
    labels.slice(i, i + perSheet).forEach((label, j) => {
      const col = j % g.cols, row = Math.floor(j / g.cols);
      const left = SHEET_MARGIN + col * g.cw, top = g.H - SHEET_MARGIN - row * g.ch;
      const m = codes[i + j];
      const size = m.size * QR_MODULE;
      const x0 = left + (g.cw - size) / 2, y0 = top - QUIET - size;
      for (let y = 0; y < m.size; y++) {
        // runs of dark modules on a row become one rectangle
        for (let x = 0; x < m.size; x++) {
          if (!m.on(x, y)) continue;
          let run = 1;
          while (x + run < m.size && m.on(x + run, y)) run++;
          page.drawRectangle({ x: (x0 + x * QR_MODULE) * MM, y: (y0 + (m.size - 1 - y) * QR_MODULE) * MM,
            width: run * QR_MODULE * MM, height: QR_MODULE * MM, color: rgb(0, 0, 0) });
          x += run - 1;
        }
      }
      const cx = (left + g.cw / 2) * MM;
      const skuSize = fitText(bold, label.sku, (g.cw - 0.6) * MM, SKU_PT);
      page.drawText(label.sku, { x: cx - bold.widthOfTextAtSize(label.sku, skuSize) / 2, y: (y0 - QUIET - 2.1) * MM, size: skuSize, font: bold });
      if (label.line) {
        const l = fitLine(regular, label.line, (g.cw - 0.8) * MM, LINE_PT);
        page.drawText(l.text, { x: cx - regular.widthOfTextAtSize(l.text, l.size) / 2, y: (y0 - QUIET - 4) * MM, size: l.size, font: regular });
      }
    });
  }
}


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

/** Shrinks to `min` points, then shortens with "…" so the text never runs into the next label */
function fitLine(font: PDFFont, text: string, maxWidth: number, size: number, min = 4.5): { text: string; size: number } {
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxWidth) t = t.slice(0, -2) + "…";
  return { text: t, size };
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
  if (format === "4x6-max") {
    await denseBarcodeSheets(pdf, labels);
  } else if (format === "4x6-qr") {
    await denseQrSheets(pdf, labels);
  } else if (format === "4x6") {
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
