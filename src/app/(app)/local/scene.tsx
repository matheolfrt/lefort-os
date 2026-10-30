"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { clampToRoom, fits, type Room, type Shelf } from "@/lib/warehouse";

export type View = "3d" | "top" | "walk";

const COLORS = { post: 0x3f454d, board: 0xc8a06a, selected: 0x22c55e, invalid: 0xef4444, floor: 0xd9d6cf, wall: 0xf3f1ec, person: 0x6b7a8f };
const POST = 0.035, BOARD = 0.025;

interface Props {
  room: Room; shelves: Shelf[]; selected: string | null; view: View; canEdit: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}

/** The room in 3D: orbit with the mouse or a finger, click a shelf to select it, drag it to move it (5 cm grid) */
export default function Scene({ room, shelves, selected, view, canEdit, onSelect, onMove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; persp: THREE.PerspectiveCamera; ortho: THREE.OrthographicCamera;
    controls: OrbitControls; roomGroup: THREE.Group; shelfGroup: THREE.Group; camera: THREE.Camera;
  } | null>(null);
  // the latest props, for the pointer handlers set up once
  const latest = useRef({ room, shelves, canEdit, onSelect, onMove });
  latest.current = { room, shelves, canEdit, onSelect, onMove };

  // ── set up once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9edf2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun, sun.target);

    const persp = new THREE.PerspectiveCamera(50, 1, 0.05, 1000);
    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // never under the floor

    const roomGroup = new THREE.Group(), shelfGroup = new THREE.Group();
    scene.add(roomGroup, shelfGroup);
    three.current = { renderer, scene, persp, ortho, controls, roomGroup, shelfGroup, camera: persp };

    const resize = () => {
      const w = el.clientWidth, h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      persp.aspect = w / h; persp.updateProjectionMatrix();
      fitOrtho();
    };
    const fitOrtho = () => {
      const { room: r } = latest.current;
      const w = el.clientWidth, h = Math.max(1, el.clientHeight), pad = 1.1;
      const scale = Math.max(r.w / w, r.d / h) * pad;
      ortho.left = -w * scale / 2; ortho.right = w * scale / 2; ortho.top = h * scale / 2; ortho.bottom = -h * scale / 2;
      ortho.updateProjectionMatrix();
    };
    (three.current as unknown as { fitOrtho: () => void }).fitOrtho = fitOrtho;
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ── pointer: select, drag
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let drag: { id: string; dx: number; dz: number; group: THREE.Object3D; start: { x: number; y: number }; moved: boolean; ok: boolean } | null = null;
    let down: { x: number; y: number } | null = null;
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, three.current!.camera);
    };
    const floorPoint = () => { const p = new THREE.Vector3(); return ray.ray.intersectPlane(floor, p) ? p : null; };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      pick(e);
      const hit = ray.intersectObjects(shelfGroup.children, true)[0];
      let g: THREE.Object3D | null = hit?.object ?? null;
      while (g && !g.userData.id) g = g.parent;
      if (!g) return;
      latest.current.onSelect(g.userData.id);
      if (!latest.current.canEdit) return;
      const p = floorPoint();
      if (!p) return;
      drag = { id: g.userData.id, dx: p.x - g.position.x, dz: p.z - g.position.z, group: g, start: { x: e.clientX, y: e.clientY }, moved: false, ok: true };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMovePtr = (e: PointerEvent) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < 4) return;
      drag.moved = true;
      pick(e);
      const p = floorPoint();
      if (!p) return;
      const { room: r, shelves: all } = latest.current;
      const me = all.find((s) => s.id === drag!.id);
      if (!me) return;
      const next = clampToRoom(r, { ...me, x: p.x - drag.dx, z: p.z - drag.dz });
      drag.group.position.set(next.x, 0, next.z);
      drag.group.userData.next = next;
      drag.ok = fits(r, next, all);
      tint(drag.group, drag.ok ? COLORS.selected : COLORS.invalid);
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        controls.enabled = true;
        const next = drag.group.userData.next as Shelf | undefined;
        if (drag.moved && next && drag.ok) latest.current.onMove(drag.id, next.x, next.z);
        else {
          // a place where it does not fit: back to where it was
          const me = latest.current.shelves.find((s) => s.id === drag!.id);
          if (me) drag.group.position.set(me.x, 0, me.z);
          tint(drag.group, COLORS.selected);
        }
        drag = null;
      } else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
        latest.current.onSelect(null); // a click on the floor
      }
      down = null;
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMovePtr);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, three.current!.camera); };
    loop();
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMovePtr);
      renderer.domElement.removeEventListener("pointerup", onUp);
      scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); });
      renderer.dispose(); el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // ── the room: floor with a 1 m grid, see-through walls, a person for scale
  useEffect(() => {
    const t = three.current; if (!t) return;
    clear(t.roomGroup);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.d), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95 }));
    f.rotation.x = -Math.PI / 2; f.position.set(room.w / 2, 0, room.d / 2); f.receiveShadow = true;
    t.roomGroup.add(f);
    const grid = new THREE.GridHelper(Math.max(room.w, room.d), Math.max(room.w, room.d), 0x9aa0a8, 0xbfc3c9);
    grid.position.set(Math.max(room.w, room.d) / 2, 0.002, Math.max(room.w, room.d) / 2);
    // only the part of the grid inside the room
    (grid.material as THREE.Material).clippingPlanes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), room.w), new THREE.Plane(new THREE.Vector3(0, 0, -1), room.d)];
    t.renderer.localClippingEnabled = true;
    t.roomGroup.add(grid);
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const T = 0.15;
    const walls: [number, number, number, number][] = [ // x, z, length, rotation
      [room.w / 2, -T / 2, room.w + 2 * T, 0], [room.w / 2, room.d + T / 2, room.w + 2 * T, 0],
      [-T / 2, room.d / 2, room.d, Math.PI / 2], [room.w + T / 2, room.d / 2, room.d, Math.PI / 2],
    ];
    for (const [x, z, len, rot] of walls) {
      const geo = new THREE.BoxGeometry(len, room.h, T);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, room.h / 2, z); m.rotation.y = rot;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x7c828b }));
      edges.position.copy(m.position); edges.rotation.copy(m.rotation);
      t.roomGroup.add(m, edges);
    }
    // a person, 1,75 m, near the front wall, a little to the side (in sight from the eye-level view, not in its way)
    const person = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: COLORS.person });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.1, 4, 12), mat); body.position.y = 0.2 + 0.55 + 0.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat); head.position.y = 1.63;
    person.add(body, head); person.position.set(Math.min(room.w - 0.5, room.w / 2 + 2), 0, Math.max(0.5, room.d - 1.8));
    person.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    t.roomGroup.add(person);
    (t as unknown as { fitOrtho: () => void }).fitOrtho();
  }, [room]);

  // ── the shelves
  useEffect(() => {
    const t = three.current; if (!t) return;
    clear(t.shelfGroup);
    const postGeo = new THREE.BoxGeometry(POST, 1, POST);
    const postMat = new THREE.MeshStandardMaterial({ color: COLORS.post, metalness: 0.6, roughness: 0.4 });
    for (const s of shelves) {
      const g = new THREE.Group();
      g.userData.id = s.id;
      const inner = new THREE.Group();
      inner.rotation.y = s.rot === 90 ? Math.PI / 2 : 0;
      const boardMat = new THREE.MeshStandardMaterial({ color: s.id === selected ? COLORS.selected : COLORS.board, roughness: 0.8 });
      boardMat.userData.board = true;
      const boardGeo = new THREE.BoxGeometry(s.w, BOARD, s.d);
      for (let i = 0; i < s.levels; i++) {
        const b = new THREE.Mesh(boardGeo, boardMat);
        b.position.y = 0.1 + (i * (s.h - 0.12)) / Math.max(1, s.levels - 1);
        b.castShadow = true; b.receiveShadow = true;
        inner.add(b);
        // the outline of the top board: each shelf stands out, even seen from above in a row
        if (i === s.levels - 1) {
          const edge = new THREE.LineSegments(new THREE.EdgesGeometry(boardGeo), new THREE.LineBasicMaterial({ color: 0x5b4630 }));
          edge.position.copy(b.position);
          // a line catches clicks up to a metre away: only the boards and posts are picked
          edge.raycast = () => {};
          inner.add(edge);
        }
      }
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = new THREE.Mesh(postGeo, postMat);
        p.scale.y = s.h; p.position.set(px * (s.w / 2 - POST / 2), s.h / 2, pz * (s.d / 2 - POST / 2));
        p.castShadow = true;
        inner.add(p);
      }
      g.add(inner);
      g.position.set(s.x, 0, s.z);
      t.shelfGroup.add(g);
    }
  }, [shelves, selected]);

  // ── the point of view
  useEffect(() => {
    const t = three.current; if (!t) return;
    const c = new THREE.Vector3(room.w / 2, 0, room.d / 2);
    t.controls.enabled = true;
    // shadows help in 3D, they blur a plan seen from above
    t.renderer.shadowMap.enabled = view !== "top";
    t.scene.traverse((o) => { const mt = (o as THREE.Mesh).material as THREE.Material | undefined; if (mt) mt.needsUpdate = true; });
    if (view === "top") {
      t.camera = t.ortho;
      // straight above, the back wall at the top of the screen (the orbit controls need « up » to stay vertical)
      t.ortho.position.set(c.x, 50, c.z + 0.001); t.ortho.up.set(0, 1, 0); t.ortho.lookAt(c);
      (t as unknown as { fitOrtho: () => void }).fitOrtho();
      t.controls.object = t.ortho; t.controls.target.copy(c); t.controls.enableRotate = false;
    } else if (view === "walk") {
      t.camera = t.persp;
      t.persp.position.set(room.w / 2, 1.65, room.d - 0.3); t.persp.up.set(0, 1, 0);
      t.controls.object = t.persp; t.controls.target.set(room.w / 2, 1.5, room.d / 2); t.controls.enableRotate = true;
    } else {
      t.camera = t.persp;
      const span = Math.max(room.w, room.d);
      // a narrow screen (a phone held upright) needs the camera further back to see the whole room
      const back = t.persp.aspect < 1.3 ? Math.pow(1.3 / Math.max(0.3, t.persp.aspect), 0.85) : 1;
      t.persp.position.set(room.w / 2 + room.w * 0.12 * back, span * 0.62 * back, room.d / 2 + (room.d / 2 + span * 0.55) * back); t.persp.up.set(0, 1, 0);
      t.controls.object = t.persp; t.controls.target.copy(c); t.controls.enableRotate = true;
    }
    t.controls.update();
  }, [view, room]);

  return <div ref={host} className="h-full w-full" data-testid="scene" />;
}

function clear(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material as THREE.Material | undefined; mt?.dispose?.(); });
  }
}

function tint(g: THREE.Object3D, color: number) {
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.userData?.board) m.color.setHex(color);
  });
}
