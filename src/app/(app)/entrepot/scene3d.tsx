"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { levelY, slotPoint, type Layout, type PlacedShelf, type WarehouseConfig, type Zone } from "@/lib/warehouse3d/config";
import { groupOf, ramp, type Group, type ShelfHeat, type Snapshot, type WItem } from "@/lib/warehouse3d/model";
import type { Pt } from "@/lib/warehouse3d/path";

// The building in 3D, light on purpose: one instanced mesh for all the posts, one for all the boards, one for all the
// items, one for the empty places — a few draw calls whatever the stock. It only renders when something changes.

export type Pick = { kind: "item"; id: string } | { kind: "level"; shelf: string; level: number } | { kind: "zone"; id: string } | { kind: "none" };
export interface SceneHandle { overview(): void; focus(p: { x: number; y: number; z: number }, dist?: number): void; zoom(f: number): void; png(): string }
export interface Highlight { x: number; y: number; z: number; w: number; h: number; d: number }

interface Props {
  config: WarehouseConfig; layout: Layout; snap: Snapshot | null;
  mode: "stock" | "performance" | "picking" | "config";
  visible: Set<Group>; heat: Map<string, ShelfHeat> | null;
  selectedShelf: string | null; selectedItem: string | null; highlight: Highlight | null;
  path: Pt[] | null; pathDone: number; stops: { x: number; z: number; n: number; done: boolean; current: boolean }[];
  dark: boolean; onPick: (p: Pick) => void;
}

const POST = 0.035, BOARD = 0.025, ITEM_D = 0.42, ITEM_H = 0.22;
const reduce = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function label(text: string, opts: { size?: number; bg?: string; fg?: string; bold?: boolean } = {}) {
  const size = opts.size ?? 48, pad = size * 0.45;
  const c = document.createElement("canvas"), ctx = c.getContext("2d")!;
  ctx.font = `${opts.bold ? 700 : 600} ${size}px Inter, system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width + pad * 2), h = Math.ceil(size * 1.6);
  c.width = w; c.height = h;
  ctx.font = `${opts.bold ? 700 : 600} ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = opts.bg ?? "rgba(17,20,24,0.86)";
  const r = h / 2.6; ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.fill();
  ctx.fillStyle = opts.fg ?? "#ffffff"; ctx.textBaseline = "middle"; ctx.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  s.userData.aspect = w / h;
  return s;
}

const Scene3D = forwardRef<SceneHandle, Props>(function Scene3D(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const t = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    world: THREE.Group; overlay: THREE.Group; render: () => void; anim: (to: THREE.Vector3, target: THREE.Vector3) => void;
    boards?: THREE.InstancedMesh; boardIndex: { shelf: string; level: number }[];
    items?: THREE.InstancedMesh; itemIndex: string[];
  } | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // ── once: renderer, camera, controls, picking, render on demand
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-hidden", "true");
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7c8594, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(-20, 40, 30); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2 - 0.05; controls.minDistance = 1.5; controls.maxDistance = 300;
    controls.screenSpacePanning = true;
    const world = new THREE.Group(), overlay = new THREE.Group();
    scene.add(world, overlay);

    let frame = 0;
    // labels keep a readable size: their size in the room, but never smaller than 1,4 % or larger than 3,5 % of the view
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitLabels = () => {
      for (const g of [world, overlay]) for (const o of g.children) {
        if (!(o instanceof THREE.Sprite)) continue;
        const k0 = (o.userData.k ??= o.scale.y) as number, view = 2 * tanHalf * camera.position.distanceTo(o.position);
        const k = Math.min(Math.max(k0, view * 0.014), view * 0.035);
        o.scale.set(k * (o.userData.aspect ?? 1), k, 1);
      }
    };
    const render = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fitLabels(); renderer.render(scene, camera); }); };
    controls.addEventListener("change", render);
    let animId = 0;
    const anim = (to: THREE.Vector3, target: THREE.Vector3) => {
      cancelAnimationFrame(animId);
      if (reduce()) { camera.position.copy(to); controls.target.copy(target); controls.update(); render(); return; }
      const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now(), dur = 650;
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(p0, to, e); controls.target.lerpVectors(t0, target, e); controls.update(); render();
        if (k < 1) animId = requestAnimationFrame(step);
      };
      animId = requestAnimationFrame(step);
    };
    t.current = { renderer, scene, camera, controls, world, overlay, render, anim, boardIndex: [], itemIndex: [] };

    const resize = () => { const w = el.clientWidth, h = Math.max(1, el.clientHeight); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // picking: a click (not a drag) on an item, a board, or a zone floor
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const cur = t.current!;
      const targets = [cur.items, cur.boards, ...world.children.filter((o) => o.userData.zone)].filter(Boolean) as THREE.Object3D[];
      const hit = ray.intersectObjects(targets, false)[0];
      if (!hit) return latest.current.onPick({ kind: "none" });
      if (hit.object === cur.items && hit.instanceId != null) return latest.current.onPick({ kind: "item", id: cur.itemIndex[hit.instanceId] });
      if (hit.object === cur.boards && hit.instanceId != null) { const b = cur.boardIndex[hit.instanceId]; return latest.current.onPick({ kind: "level", shelf: b.shelf, level: b.level }); }
      if (hit.object.userData.zone) return latest.current.onPick({ kind: "zone", id: hit.object.userData.zone });
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(animId); ro.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      dispose(world); dispose(overlay); renderer.dispose(); el.removeChild(renderer.domElement); t.current = null;
    };
  }, []);

  /** The whole room in the frame, seen from the front left and from above, whatever the size of the screen */
  const overviewView = () => {
    const c = latest.current.config, x = t.current; if (!x) return;
    const L = c.room.length, W = c.room.width, H = c.shelf.height + 0.6;
    const target = new THREE.Vector3(L / 2, 0, W / 2);
    // a tall screen (phone) looks along the length of the room, a wide one across it
    const dir = (x.camera.aspect < 0.9 === L > W ? new THREE.Vector3(1, 1.7, 0.18) : new THREE.Vector3(-0.3, 0.95, 1)).normalize();
    const corners = [0, L].flatMap((cx) => [0, W].flatMap((cz) => [0, H].map((cy) => new THREE.Vector3(cx, cy, cz))));
    const cam = x.camera.clone(); let dist = Math.max(L, W);
    for (let i = 0; i < 6; i++) {
      cam.position.copy(target).addScaledVector(dir, dist); cam.lookAt(target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const m = Math.max(...corners.map((v) => { const q = v.clone().project(cam); return Math.max(Math.abs(q.x), Math.abs(q.y)); }));
      dist *= Math.max(0.5, m / 0.96);
    }
    x.anim(target.clone().addScaledVector(dir, dist), target);
  };
  useImperativeHandle(ref, () => ({
    overview: overviewView,
    focus(p, dist = 4.5) {
      const x = t.current; if (!x) return;
      const dir = x.camera.position.clone().sub(x.controls.target).setY(0).normalize();
      if (!dir.lengthSq()) dir.set(0, 0, 1);
      x.anim(new THREE.Vector3(p.x + dir.x * dist, p.y + dist * 0.7, p.z + dir.z * dist), new THREE.Vector3(p.x, p.y, p.z));
    },
    zoom(f) {
      const x = t.current; if (!x) return;
      const to = x.controls.target.clone().add(x.camera.position.clone().sub(x.controls.target).multiplyScalar(f));
      x.anim(to, x.controls.target.clone());
    },
    png() { const x = t.current; if (!x) return ""; x.renderer.render(x.scene, x.camera); return x.renderer.domElement.toDataURL("image/png"); },
  }));

  // ── the building (room, zones, racks, labels): rebuilt when the configuration changes
  const { config, layout: lay, dark } = props;
  useEffect(() => {
    const x = t.current; if (!x) return;
    dispose(x.world);
    const c = config, L = c.room.length, W = c.room.width;
    x.scene.background = new THREE.Color(dark ? 0x0d1014 : 0xeef1f5);
    // floor and a light 1 m grid
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), new THREE.MeshLambertMaterial({ color: dark ? 0x1a1f26 : 0xdfe3e8 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(L / 2, 0, W / 2); x.world.add(floor);
    const lines: number[] = [];
    for (let i = 0; i <= L; i++) lines.push(i, 0.003, 0, i, 0.003, W);
    for (let j = 0; j <= W; j++) lines.push(0, 0.003, j, L, 0.003, j);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    x.world.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: dark ? 0x262c35 : 0xcfd5dc })));
    // low walls (1 m) so the inside stays visible, outlined to the ceiling
    const wallMat = new THREE.MeshLambertMaterial({ color: dark ? 0x2a313b : 0xc9d0d8 });
    for (const [px, pz, len, rot] of [[L / 2, -0.05, L, 0], [L / 2, W + 0.05, L, 0], [-0.05, W / 2, W, Math.PI / 2], [L + 0.05, W / 2, W, Math.PI / 2]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 1, 0.1), wallMat); m.position.set(px, 0.5, pz); m.rotation.y = rot; x.world.add(m);
    }
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(L, c.room.height, W));
    x.world.add(new THREE.Box3Helper(box, new THREE.Color(dark ? 0x3a424d : 0xb4bcc6)));

    // zones: a tinted floor, a label, and their furniture
    for (const z of c.zones) addZone(x.world, z, dark);

    // racks: every post and every board of the building in two instanced meshes
    const shelves = [...lay.shelves.values()];
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(POST, 1, POST), new THREE.MeshLambertMaterial({ color: dark ? 0x9aa3ae : 0x4a525c }), shelves.length * 4);
    const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, BOARD, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), shelves.length * c.shelf.levels);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let pi = 0, bi = 0;
    const boardIndex: { shelf: string; level: number }[] = [];
    for (const s of shelves) {
      const rotY = s.rot === 90 ? Math.PI / 2 : 0; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ox = dx * (c.shelf.width / 2 - POST / 2), oz = dz * (c.shelf.depth / 2 - POST / 2);
        const [rx, rz] = s.rot === 90 ? [oz, ox] : [ox, oz];
        m4.compose(pos.set(s.x + rx, c.shelf.height / 2, s.z + rz), q, sc.set(1, c.shelf.height, 1)); posts.setMatrixAt(pi++, m4);
      }
      for (let lv = 1; lv <= c.shelf.levels; lv++) {
        m4.compose(pos.set(s.x, levelY(c, lv), s.z), q, sc.set(c.shelf.width, 1, c.shelf.depth)); boards.setMatrixAt(bi, m4);
        boardIndex[bi++] = { shelf: s.id, level: lv };
      }
    }
    posts.instanceMatrix.needsUpdate = true; boards.instanceMatrix.needsUpdate = true;
    posts.computeBoundingSphere(); boards.computeBoundingSphere();
    x.world.add(posts, boards);
    x.boards = boards; x.boardIndex = boardIndex;

    // labels: RACK A at the end of each rack, A-01 above each shelf
    for (const r of lay.racks) {
      const first = r.shelves[0]; if (!first) continue;
      const s = label(`RACK ${r.code}`, { size: 56, bold: true, bg: dark ? "rgba(255,255,255,0.92)" : "rgba(17,20,24,0.88)", fg: dark ? "#111418" : "#ffffff" });
      const k = 0.55; s.scale.set(k * s.userData.aspect, k, 1);
      s.position.set(first.x, c.shelf.height + 0.62, first.z);
      x.world.add(s);
      for (const sh of r.shelves) {
        const l = label(sh.id, { size: 40, bg: dark ? "rgba(30,35,42,0.9)" : "rgba(255,255,255,0.95)", fg: dark ? "#e6e9ee" : "#1b1f24" });
        const kk = 0.26; l.scale.set(kk * l.userData.aspect, kk, 1);
        l.position.set(sh.x, c.shelf.height + 0.16, sh.z);
        l.userData.shelfLabel = sh.id;
        x.world.add(l);
      }
    }
    x.render();
    overviewView();
  }, [config, lay, dark]);

  // ── board colours: neutral, the selected shelf, or the performance heat
  const { heat, mode, selectedShelf } = props;
  useEffect(() => {
    const x = t.current; if (!x?.boards) return;
    const col = new THREE.Color();
    const base = dark ? 0x59616c : 0xb9a07c;
    x.boardIndex.forEach((b, i) => {
      if (mode === "performance" && heat) { const v = heat.get(b.shelf)?.t; col.set(v == null ? (dark ? "#3b424d" : "#d9dde3") : ramp(v)); }
      else col.setHex(base);
      if (b.shelf === selectedShelf) col.set("#22c55e");
      x.boards!.setColorAt(i, col);
    });
    if (x.boards.instanceColor) x.boards.instanceColor.needsUpdate = true;
    x.render();
  }, [heat, mode, selectedShelf, dark, config, lay]);

  // ── the items, and the empty places
  const { snap, visible, selectedItem } = props;
  useEffect(() => {
    const x = t.current; if (!x) return;
    for (const o of x.world.children.filter((o) => o.userData.stock)) { x.world.remove(o); dispose(o); }
    if (!snap) { x.items = undefined; x.itemIndex = []; x.render(); return; }
    const c = config, colors = c.colors;
    const prep = snap.staging.find((s) => s.code === "EMP-PREPARATION")?.id ?? null;
    const placed: { it: WItem; p: THREE.Vector3; rot: number }[] = [];
    const used = new Map<string, Set<number>>();
    // on a level: at its place
    for (const it of snap.items) {
      const lv = it.loc ? snap.levelById.get(it.loc) : null;
      if (!lv) continue;
      const sh = lay.shelves.get(`${lv.rack}-${String(lv.shelf).padStart(2, "0")}`); if (!sh || lv.level > c.shelf.levels) continue;
      const p = slotPoint(c, sh, lv.level, it.pos ?? 1);
      placed.push({ it, p: new THREE.Vector3(p.x, p.y + ITEM_H / 2, p.z), rot: sh.rot });
      (used.get(lv.id) ?? used.set(lv.id, new Set()).get(lv.id)!).add(it.pos ?? 1);
    }
    // in a zone: in rows on its floor
    const zoneOf = new Map<string, Zone>();
    for (const z of c.zones) for (const code of z.locations) { const st = snap.staging.find((s) => s.code === code); if (st) zoneOf.set(st.id, z); }
    const inZone = new Map<string, number>();
    for (const it of snap.items) {
      const z = it.loc ? zoneOf.get(it.loc) : null; if (!z) continue;
      const n = inZone.get(z.id) ?? 0; inZone.set(z.id, n + 1);
      // on the work table at the back of the zone: two rows, then stacked
      const per = Math.max(1, Math.floor((z.w - 0.6) / 0.12)), layer = Math.floor(n / (per * 2)), row = Math.floor(n / per) % 2, col = n % per;
      placed.push({ it, p: new THREE.Vector3(z.x + 0.35 + col * 0.12, 0.775 + ITEM_H / 2 + layer * (ITEM_H + 0.02), z.z + z.d - 0.8 + row * 0.4), rot: 0 });
    }
    const shown = placed.filter((pl) => visible.has(groupOf(pl.it, prep)));
    const step = (c.shelf.width - 0.06) / c.shelf.perLevel;
    const iw = Math.max(0.015, Math.min(0.1, step * 0.82));
    const items = new THREE.InstancedMesh(new THREE.BoxGeometry(iw, ITEM_H, ITEM_D), new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, shown.length));
    items.count = shown.length;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color(), one = new THREE.Vector3(1, 1, 1);
    shown.forEach((pl, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot === 90 ? Math.PI / 2 : 0);
      m4.compose(pl.p, q, pl.it.id === selectedItem ? new THREE.Vector3(1.3, 1.25, 1.1) : one); items.setMatrixAt(i, m4);
      col.set(pl.it.id === selectedItem ? "#ffffff" : colors[groupOf(pl.it, prep)]); items.setColorAt(i, col);
    });
    items.instanceMatrix.needsUpdate = true; if (items.instanceColor) items.instanceColor.needsUpdate = true;
    items.computeBoundingSphere(); items.userData.stock = true;
    x.world.add(items); x.items = items; x.itemIndex = shown.map((s) => s.it.id);
    // the empty places, faint
    if (visible.has("empty")) {
      const empties: THREE.Vector3[] = []; const rots: number[] = [];
      for (const lv of snap.levels) {
        const sh = lay.shelves.get(`${lv.rack}-${String(lv.shelf).padStart(2, "0")}`); if (!sh || lv.level > c.shelf.levels) continue;
        const u = used.get(lv.id);
        for (let k = 1; k <= Math.min(lv.capacity, c.shelf.perLevel); k++) {
          if (u?.has(k)) continue;
          const p = slotPoint(c, sh, lv.level, k); empties.push(new THREE.Vector3(p.x, p.y + 0.004, p.z)); rots.push(sh.rot);
        }
      }
      const e = new THREE.InstancedMesh(new THREE.BoxGeometry(iw, 0.008, ITEM_D * 0.9), new THREE.MeshBasicMaterial({ color: colors.empty, transparent: true, opacity: 0.55 }), Math.max(1, empties.length));
      e.count = empties.length;
      empties.forEach((p, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rots[i] === 90 ? Math.PI / 2 : 0); m4.compose(p, q, one); e.setMatrixAt(i, m4); });
      e.instanceMatrix.needsUpdate = true; e.computeBoundingSphere(); e.userData.stock = true; e.raycast = () => {};
      x.world.add(e);
    }
    x.render();
  }, [snap, visible, selectedItem, config, lay]);

  // ── overlay: the highlighted place, the picking path and its numbered stops
  const { highlight, path, pathDone, stops } = props;
  useEffect(() => {
    const x = t.current; if (!x) return;
    dispose(x.overlay); x.overlay.clear();
    if (highlight) {
      const g = new THREE.BoxGeometry(highlight.w, highlight.h, highlight.d);
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x22c55e, depthTest: false }));
      m.position.set(highlight.x, highlight.y, highlight.z); m.renderOrder = 20; x.overlay.add(m);
      const glow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.18, depthWrite: false }));
      glow.position.copy(m.position); x.overlay.add(glow);
      // a beam from above, visible from far away
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 8), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.6 }));
      beam.position.set(highlight.x, highlight.y + highlight.h / 2 + 1.5, highlight.z); x.overlay.add(beam);
    }
    if (path && path.length > 1) {
      // flat ribbons on the floor: walked part dimmed, the rest bright
      const segs: [Pt, Pt, boolean][] = [];
      for (let i = 1; i < path.length; i++) segs.push([path[i - 1], path[i], i <= pathDone]);
      for (const [a, b, done] of segs) {
        const len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 1e-3) continue;
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.01, 0.12), new THREE.MeshBasicMaterial({ color: done ? 0x64748b : 0x6366f1, transparent: true, opacity: done ? 0.45 : 0.95 }));
        m.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2); m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x); x.overlay.add(m);
      }
    }
    for (const s of stops) {
      const l = label(String(s.n), { size: 56, bold: true, bg: s.done ? "rgba(100,116,139,0.9)" : s.current ? "#22c55e" : "#4f46e5", fg: "#fff" });
      const k = s.current ? 0.5 : 0.36; l.scale.set(k * l.userData.aspect, k, 1); l.position.set(s.x, 2.6, s.z); x.overlay.add(l);
    }
    x.render();
  }, [highlight, path, pathDone, stops]);

  return <div ref={host} className="absolute inset-0" data-testid="scene" />;
});
export default Scene3D;

function addZone(world: THREE.Group, z: Zone, dark: boolean) {
  const tint = { reception: 0xf59e0b, photo: 0x8b5cf6, shipping: 0x0ea5e9, custom: 0x64748b }[z.kind];
  const f = new THREE.Mesh(new THREE.PlaneGeometry(z.w, z.d), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: dark ? 0.16 : 0.13, depthWrite: false }));
  f.rotation.x = -Math.PI / 2; f.position.set(z.x + z.w / 2, 0.006, z.z + z.d / 2); f.userData.zone = z.id; world.add(f);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(z.w, z.d)), new THREE.LineBasicMaterial({ color: tint }));
  edge.rotation.x = -Math.PI / 2; edge.position.copy(f.position).setY(0.008); world.add(edge);
  const l = label(z.label.toUpperCase(), { size: 44, bold: true, bg: dark ? "rgba(30,35,42,0.92)" : "rgba(255,255,255,0.96)", fg: dark ? "#e6e9ee" : "#1b1f24" });
  const k = 0.42; l.scale.set(k * l.userData.aspect, k, 1); l.position.set(z.x + z.w / 2, 1.5, z.z + z.d / 2); world.add(l);
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, zz: number) => { const m = new THREE.Mesh(geo, mat(color)); m.position.set(x, y, zz); world.add(m); return m; };
  // a work table along the back of every zone: the staging racks of the workflow stand on it
  add(new THREE.BoxGeometry(Math.max(0.8, z.w - 0.4), 0.05, 0.8), dark ? 0x6b7280 : 0xd6cbb8, z.x + z.w / 2, 0.75, z.z + z.d - 0.6);
  if (z.kind === "photo") {
    const ft = z.features;
    if (ft?.backdrop) { const b = add(new THREE.PlaneGeometry(2.4, 2.4), 0xf5f5f4, z.x + 1.5, 1.2, z.z + 0.15); (b.material as THREE.Material).side = THREE.DoubleSide; }
    if (ft?.table) add(new THREE.BoxGeometry(1.4, 0.04, 0.7), 0xe7e5e4, z.x + 1.5, 0.85, z.z + 1.4);
    if (ft?.mannequin) {
      add(new THREE.CylinderGeometry(0.17, 0.13, 0.62, 12), 0xd6d3d1, z.x + 2.8, 1.25, z.z + 0.9);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 6), 0x52525b, z.x + 2.8, 0.47, z.z + 0.9);
    }
    if (ft?.lights) for (const dx of [0.4, 2.6]) {
      add(new THREE.CylinderGeometry(0.015, 0.015, 1.9, 6), 0x3f3f46, z.x + dx, 0.95, z.z + 1.9);
      add(new THREE.BoxGeometry(0.45, 0.45, 0.08), 0xfafafa, z.x + dx, 1.95, z.z + 1.9);
    }
    if (ft?.measure) add(new THREE.BoxGeometry(1.2, 0.01, 0.8), 0xa3e635, z.x + 1.5, 0.012, z.z + 2.6);
  } else if (z.kind === "shipping") {
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.4, 0.3, 0.3), 0xc8a06a, z.x + 0.6 + i * 0.55, 0.15, z.z + 0.6);
  } else if (z.kind === "reception") {
    add(new THREE.BoxGeometry(1.2, 0.14, 0.8), 0xa16207, z.x + 1, 0.07, z.z + 0.8); // a pallet
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.5, 0.35, 0.4), 0xc8a06a, z.x + 0.6 + i * 0.4, 0.32, z.z + 0.8);
  }
}

function dispose(o: THREE.Object3D) {
  const list = [...o.children];
  for (const c of list) {
    dispose(c); o.remove(c);
    const m = c as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mt of mats) { (mt as THREE.SpriteMaterial).map?.dispose?.(); mt.dispose(); }
  }
}

export type { PlacedShelf };
