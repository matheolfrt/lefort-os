// Vinted bordereaux on the 4 × 6 roll: page size, zone cut, quarter turn. Run: npm run test:label
// With pdftoppm installed, LABEL_PNG=dossier also writes the pages as images to look at.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ROLL, ZONES, fitLabel, placement, sourceKind } from "../src/lib/shipping-label";

async function a4WithLabel() {
  // A4 page, label in the top-left quarter (black frame + « LABEL »), a red block in the bottom-right quarter
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 10, y: 431, width: 277, height: 400, borderWidth: 6, borderColor: rgb(0, 0, 0) });
  page.drawText("LABEL", { x: 60, y: 760, size: 48, font });
  page.drawRectangle({ x: 320, y: 20, width: 260, height: 380, color: rgb(1, 0, 0) });
  return doc.save();
}

(async () => {
  const src = await a4WithLabel();

  const p = placement(297.6, 420.9); // portrait quarter: no turn
  assert.equal(p.rotate, false);
  assert.ok(Math.abs(p.x * 2 + p.w - ROLL.w) < 0.01 && Math.abs(p.y * 2 + p.h - ROLL.h) < 0.01, "centré");
  assert.equal(placement(595, 421).rotate, true, "une moitié de A4 (plus large que haute) est tournée");
  console.log("ok  placement : centré, tourné seulement quand c'est plus grand");

  const top = await fitLabel({ kind: "pdf", bytes: src }, ZONES.topLeft.zone);
  const doc = await PDFDocument.load(top.pdf);
  assert.equal(top.pages, 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 288) < 0.1 && Math.abs(height - 432) < 0.1, `102 × 152 mm (${width} × ${height})`);
  console.log("ok  page au format du rouleau 4 × 6");

  const half = await fitLabel({ kind: "pdf", bytes: src }, ZONES.top.zone);
  assert.equal((await PDFDocument.load(half.pdf)).getPageCount(), 1);

  // a 2-page PDF gives 2 labels
  const two = await PDFDocument.create();
  for (const pg of await two.copyPages(await PDFDocument.load(src), [0, 0])) two.addPage(pg);
  assert.equal((await fitLabel({ kind: "pdf", bytes: await two.save() }, ZONES.page.zone)).pages, 2);
  console.log("ok  une étiquette par page du PDF");

  assert.equal(sourceKind({ name: "Bordereau.PDF", type: "" }), "pdf");
  assert.equal(sourceKind({ name: "capture.jpeg", type: "image/jpeg" }), "jpg");
  assert.equal(sourceKind({ name: "x.heic", type: "image/heic" }), null);
  console.log("ok  fichiers acceptés : PDF, PNG, JPG");

  // Pixel check when pdftoppm is there: the quarter must show the black frame and no red, the bottom half must turn
  let rendered = false;
  try { execFileSync("pdftoppm", ["-v"], { stdio: "ignore" }); rendered = true; } catch { /* no renderer */ }
  if (rendered) {
    const dir = process.env.LABEL_PNG ?? mkdtempSync(join(tmpdir(), "label-"));
    const ppm = (name: string, pdf: Uint8Array) => {
      writeFileSync(join(dir, `${name}.pdf`), pdf);
      execFileSync("pdftoppm", ["-r", "30", "-png", "-singlefile", join(dir, `${name}.pdf`), join(dir, name)]);
      execFileSync("pdftoppm", ["-r", "30", "-singlefile", join(dir, `${name}.pdf`), join(dir, name)]);
      const buf = readFileSync(join(dir, `${name}.ppm`));
      // P6 header: "P6\n<w> <h>\n255\n"
      const head = buf.subarray(0, 40).toString("latin1").split(/\s+/);
      const w = Number(head[1]), h = Number(head[2]);
      const off = buf.indexOf(Buffer.from("255\n"), 0) + 4;
      return { w, h, px: (x: number, y: number) => [...buf.subarray(off + (y * w + x) * 3, off + (y * w + x) * 3 + 3)] };
    };
    const q = ppm("quart", top.pdf);
    let dark = 0, red = 0;
    for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) {
      const [r, g, b] = q.px(x, y);
      if (r < 80 && g < 80 && b < 80) dark++;
      if (r > 200 && g < 80 && b < 80) red++;
    }
    assert.ok(dark > 50, "le cadre noir du bordereau est là");
    assert.equal(red, 0, "rien de l'autre quart ne déborde");

    const b = ppm("bas", (await fitLabel({ kind: "pdf", bytes: src }, ZONES.bottom.zone)).pdf);
    // bottom half: red block is on the right of the A4 page → after the clockwise turn it sits at the bottom of the roll page
    let redTop = 0, redBottom = 0;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const [r, g, bl] = b.px(x, y);
      if (r > 200 && g < 80 && bl < 80) { if (y < b.h / 2) redTop++; else redBottom++; }
    }
    assert.ok(redBottom > 50 && redTop < redBottom / 10, `moitié tournée d'un quart (rouge en haut ${redTop}, en bas ${redBottom})`);
    console.log(`ok  rendu vérifié au pixel (images dans ${dir})`);
  } else console.log("--  pdftoppm absent : rendu non vérifié");
  console.log("\n5 tests réussis");
})().catch((e) => { console.error(e); process.exit(1); });
