const SAMPLE = `# Example: priority puzzle
nb_drones: 5

start_hub: start 0 0 [color=green]
hub: slow_path1 1 -1 [zone=restricted color=red]
hub: slow_path2 2 -1 [color=red]
hub: fast_junction 1 0 [zone=priority color=blue max_drones=2]
hub: fast_path 2 0 [zone=priority color=blue]
hub: merge_point 3 0 [color=yellow max_drones=3]
end_hub: goal 4 0 [color=green]

connection: start-slow_path1
connection: start-fast_junction
connection: slow_path1-slow_path2
connection: slow_path2-merge_point
connection: fast_junction-fast_path
connection: fast_path-merge_point
connection: merge_point-goal [max_link_capacity=2]
`;
const COLORS = ["red", "orange", "gold", "yellow", "lime", "green", "cyan", "blue", "purple", "magenta", "brown", "gray", "black"];
const DRAFT_KEY = "flyin-plotter-draft";
const NS = "http://www.w3.org/2000/svg";
const R = 15;
const $ = (id) => document.getElementById(id);
const svg = $("svg");

let state = parseMap(SAMPLE).map;
let view = { cx: 0, cy: 0, k: 60 };
let selection = null;
let tool = "select";
let linkFrom = null;
let rubber = null;
let gesture = null;
let undoStack = [], redoStack = [], lastKey = null;
let keySerial = 0;
let lastChecks = { errors: [], warnings: [], route: null };

/* ---------- state ---------- */
function mutate(fn, key) {
  if (!key || key !== lastKey) {
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > 200) undoStack.shift();
  }
  lastKey = key || null;
  redoStack = [];
  fn();
  refresh();
}
function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(state));
  state = JSON.parse(from.pop());
  lastKey = null;
  if (selection && !findSelected()) selection = null;
  linkFrom = null;
  syncTop();
  renderInspector();
  refresh();
}
function findHub(id) { return state.hubs.find((h) => h.id === id); }
function findSelected() {
  if (!selection) return null;
  return selection.type === "hub" ? findHub(selection.id) : state.conns.find((c) => c.id === selection.id);
}
function select(sel) { selection = sel; renderInspector(); renderChart(); }
function setTool(next) {
  tool = next;
  linkFrom = null; rubber = null;
  document.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === tool)));
  say({ select: "Drag a hub to move it. Drag empty space to pan.", hub: "Click the grid to place a hub.", link: "Drag from one hub to another, or click both." }[tool], false);
  renderChart();
}
function say(text, flash = true) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("flash", flash);
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch (e) { /* the map still works without a draft */ }
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const m = JSON.parse(raw);
    if (!Array.isArray(m.hubs) || !Array.isArray(m.conns) || !m.nextId) return false;
    state = m;
    return true;
  } catch (e) { return false; }
}
function freeName() {
  const used = new Set(state.hubs.map((h) => h.name));
  let n = 1;
  while (used.has(`hub${n}`)) n++;
  return `hub${n}`;
}
function addHub(x, y) {
  /* A map needs a start and an end, so the first hubs placed fill those roles. */
  const missing = (role) => !state.hubs.some((h) => h.role === role);
  const role = missing("start") ? "start" : missing("end") ? "end" : "hub";
  const name = role !== "hub" && !state.hubs.some((h) => h.name === role) ? role : freeName();
  const hub = { id: state.nextId, name, x, y, role, zone: "normal", color: "", max: 1 };
  mutate(() => { state.nextId++; state.hubs.push(hub); });
  select({ type: "hub", id: hub.id });
  const next = { start: " Click again to place the end hub.", end: " Press L, then drag between hubs to connect them.", hub: "" }[role];
  say(`Placed ${name} at (${x}, ${y}).${next}`);
}
function addLink(a, b) {
  if (a === b) { say("A hub can't connect to itself."); return; }
  if (state.conns.some((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))) { say("These hubs are already connected."); return; }
  const conn = { id: state.nextId, a, b, cap: 1 };
  mutate(() => { state.nextId++; state.conns.push(conn); });
  select({ type: "conn", id: conn.id });
  say(`Connected ${findHub(a).name} to ${findHub(b).name}.`);
}
function removeSelected() {
  const item = findSelected();
  if (!item) return;
  const sel = selection;
  mutate(() => {
    if (sel.type === "hub") {
      state.hubs = state.hubs.filter((h) => h.id !== sel.id);
      state.conns = state.conns.filter((c) => c.a !== sel.id && c.b !== sel.id);
    } else {
      state.conns = state.conns.filter((c) => c.id !== sel.id);
    }
  });
  select(null);
  say("Deleted. Undo brings it back.");
}

/* ---------- geometry ---------- */
function size() { const r = svg.getBoundingClientRect(); return { w: r.width || 800, h: r.height || 600 }; }
function toScreen(x, y) { const { w, h } = size(); return { x: w / 2 + (Number(x) - view.cx) * view.k, y: h / 2 - (Number(y) - view.cy) * view.k }; }
function toWorld(px, py) { const { w, h } = size(); return { x: view.cx + (px - w / 2) / view.k, y: view.cy - (py - h / 2) / view.k }; }
function local(e) { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hubAt(p) {
  let best = null, bestD = (R + 6) * (R + 6);
  for (const h of state.hubs) {
    const s = toScreen(h.x, h.y);
    const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2;
    if (d <= bestD) { best = h; bestD = d; }
  }
  return best;
}
function fitView() {
  const { w, h } = size();
  if (!state.hubs.length) { view = { cx: 0, cy: 0, k: 60 }; renderChart(); return; }
  const xs = state.hubs.map((n) => Number(n.x) || 0), ys = state.hubs.map((n) => Number(n.y) || 0);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const railRoom = 150;
  const k = Math.min((w - railRoom * 2) / Math.max(x1 - x0, 1), (h - 150) / Math.max(y1 - y0, 1), 110);
  view = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k: Math.max(k, 18) };
  renderChart();
}
function zoomAt(p, factor) {
  const before = toWorld(p.x, p.y);
  view.k = Math.min(180, Math.max(14, view.k * factor));
  const after = toWorld(p.x, p.y);
  view.cx += before.x - after.x;
  view.cy += before.y - after.y;
  renderChart();
}

/* ---------- drawing ---------- */
function el(name, attrs, parent, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function polygon(sides, r, rot) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
const SYSTEM_COLORS = { red: "#ff3b30", orange: "#ff9500", gold: "#ffcc00", yellow: "#ffd60a", lime: "#a4e04b", green: "#34c759",
  cyan: "#32ade6", blue: "#007aff", purple: "#af52de", magenta: "#ff2d92", brown: "#a2845e", gray: "#8e8e93", black: "#1c1c1e" };
const shade = (c) => SYSTEM_COLORS[String(c).toLowerCase()] || c;
function usableColor(c) { return c && window.CSS && CSS.supports("color", c); }
function zoneShape(zone, parent, color) {
  const cls = `h-body ${zone}${usableColor(color) ? "" : " none"}`;
  const fill = usableColor(color) ? { fill: shade(color) } : {};
  if (zone === "priority") el("polygon", { class: cls, points: polygon(4, R + 3, 0), ...fill }, parent);
  else if (zone === "restricted") {
    el("circle", { class: "h-restrict", r: R + 5 }, parent);
    el("polygon", { class: cls, points: polygon(6, R, 0), ...fill }, parent);
  } else if (zone === "blocked") {
    el("rect", { class: cls, x: -R + 2, y: -R + 2, width: 2 * R - 4, height: 2 * R - 4, ...fill }, parent);
    const d = R - 6;
    el("line", { class: "h-x", x1: -d, y1: -d, x2: d, y2: d }, parent);
    el("line", { class: "h-x", x1: -d, y1: d, x2: d, y2: -d }, parent);
  } else el("circle", { class: cls, r: R, ...fill }, parent);
}
function renderGrid(root) {
  const { w, h } = size();
  const tl = toWorld(0, 0), br = toWorld(w, h);
  const step = view.k < 24 ? 5 : view.k < 40 ? 2 : 1;
  const x0 = Math.ceil(tl.x / step) * step, y0 = Math.ceil(br.y / step) * step;
  let minor = "";
  for (let x = x0; x <= br.x; x += step) { const s = toScreen(x, 0).x; minor += `M${s.toFixed(1)} 0V${h}`; }
  for (let y = y0; y <= tl.y; y += step) { const s = toScreen(0, y).y; minor += `M0 ${s.toFixed(1)}H${w}`; }
  el("path", { class: "g-minor", d: minor }, root);
  const o = toScreen(0, 0);
  if (o.x >= 0 && o.x <= w) el("line", { class: "g-axis", x1: o.x, y1: 0, x2: o.x, y2: h }, root);
  if (o.y >= 0 && o.y <= h) el("line", { class: "g-axis", x1: 0, y1: o.y, x2: w, y2: o.y }, root);
  const labelY = Math.max(14, Math.min(h - 34, o.y + 14));
  const labelX = Math.max(6, Math.min(w - 26, o.x + 5));
  for (let x = x0; x <= br.x; x += step) if (x !== 0) el("text", { class: "g-tick", x: toScreen(x, 0).x + 3, y: labelY }, root, String(x));
  for (let y = y0; y <= tl.y; y += step) if (y !== 0) el("text", { class: "g-tick", x: labelX, y: toScreen(0, y).y - 3 }, root, String(y));
}
function renderChart() {
  svg.replaceChildren();
  const { w, h } = size();
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.cursor = tool === "hub" ? "crosshair" : "default";
  renderGrid(svg);

  const routeEdges = new Map();
  if (lastChecks.route) {
    const p = lastChecks.route.path;
    for (let i = 1; i < p.length; i++) routeEdges.set([p[i - 1], p[i]].sort((a, b) => a - b).join("-"), p[i - 1]);
  }
  for (const c of state.conns) {
    const a = findHub(c.a), b = findHub(c.b);
    if (!a || !b) continue;
    const s = toScreen(a.x, a.y), t = toScreen(b.x, b.y);
    const cap = Math.min(Math.max(Number(c.cap) || 1, 1), 5);
    const width = 1.5 + (cap - 1) * 1.5;
    const g = el("g", {}, svg);
    const isSel = selection && selection.type === "conn" && selection.id === c.id;
    const blocked = a.zone === "blocked" || b.zone === "blocked";
    el("line", { class: `c-line${isSel ? " sel" : ""}${blocked ? " toblocked" : ""}`, x1: s.x, y1: s.y, x2: t.x, y2: t.y, "stroke-width": width }, g);
    if (routeEdges.has([c.a, c.b].sort((m, n) => m - n).join("-"))) {
      el("line", { class: "c-route", x1: s.x, y1: s.y, x2: t.x, y2: t.y, "stroke-width": width + 8 }, g);
      const fwd = routeEdges.get([c.a, c.b].sort((m, n) => m - n).join("-")) === c.a;
      const [f0, f1] = fwd ? [s, t] : [t, s];
      el("line", { class: "c-flow", x1: f0.x, y1: f0.y, x2: f1.x, y2: f1.y, "stroke-width": width + 4 }, g);
    }
    el("line", { class: "c-hit", "data-conn": c.id, x1: s.x, y1: s.y, x2: t.x, y2: t.y }, g);
    if (String(c.cap) !== "1") el("text", { class: "badge", x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 - 7 }, g, `×${c.cap}`);
  }
  if (linkFrom !== null && rubber) {
    const f = findHub(linkFrom);
    if (f) { const s = toScreen(f.x, f.y); el("line", { class: "rubber", x1: s.x, y1: s.y, x2: rubber.x, y2: rubber.y }, svg); }
  }
  for (const n of state.hubs) {
    const s = toScreen(n.x, n.y);
    const g = el("g", { class: "hub-g", transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})` }, svg);
    const isSel = selection && selection.type === "hub" && selection.id === n.id;
    if (isSel || linkFrom === n.id) el("circle", { class: "halo", r: R + 9 }, g);
    if (n.role !== "hub") el("circle", { class: "h-ring", r: R + 5 }, g);
    zoneShape(n.zone, g, n.color);
    if (n.role !== "hub") el("text", { class: "h-role", y: -(R + 11) }, g, n.role === "start" ? "START" : "END");
    el("text", { class: "h-name", y: R + 19 }, g, n.name || "(unnamed)");
    if (n.role === "hub" && String(n.max) !== "1") el("text", { class: "badge", x: R + 9, y: -R + 3 }, g, `×${n.max}`);
    if (n.zone === "restricted") el("text", { class: "badge turns", x: -(R + 8), y: -R + 3 }, g, "2t");
  }
  if (!state.hubs.length) el("text", { class: "empty", x: w / 2, y: h / 2 }, svg, tool === "hub" ? "Click the grid to place your start hub, or drop a map file here." : "Choose Add hub to place your start hub, or drop a map file here.");
}

/* ---------- side panel ---------- */
function legendIcon(zone) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "-24 -24 48 48");
  s.setAttribute("aria-hidden", "true");
  zoneShape(zone, s, "");
  return s;
}
function renderInspector() {
  const box = $("inspector");
  const item = findSelected();
  box.replaceChildren();
  if (!item) {
    box.innerHTML = `<h2>Zone types</h2><dl class="legend" id="legend"></dl><p class="note">Select a hub or connection to edit it. A label like ×3 shows a capacity above 1, and thicker lines carry more drones.</p>`;
    const rows = [["normal", "Normal", "1 turn"], ["priority", "Priority", "1 turn, preferred"], ["restricted", "Restricted", "2 turns"], ["blocked", "Blocked", "never entered"]];
    const dl = box.querySelector("#legend");
    rows.forEach(([z, name, text]) => {
      const dt = document.createElement("dt");
      dt.appendChild(legendIcon(z));
      const dd = document.createElement("dd");
      const b = document.createElement("b");
      b.textContent = name;
      dd.append(b, `: ${text}`);
      dl.append(dt, dd);
    });
    return;
  }
  if (selection.type === "conn") return renderConnInspector(box, item);
  renderHubInspector(box, item);
}
function renderConnInspector(box, c) {
  box.innerHTML = `
    <div class="head"><h2>Connection</h2><button class="btn" id="delItem" type="button">Delete</button></div>
    <p class="note mono" id="connName"></p>
    <label class="stack"><span class="label">max_link_capacity</span><input type="number" class="mono" id="connCap" min="1" step="1"></label>
    <p class="note">How many drones can travel this link in the same turn.</p>`;
  box.querySelector("#connName").textContent = `${findHub(c.a).name} – ${findHub(c.b).name}`;
  const cap = box.querySelector("#connCap");
  cap.value = c.cap;
  const key = `cap${++keySerial}`;
  cap.addEventListener("input", () => {
    const raw = cap.value;
    mutate(() => { c.cap = isInt(raw) ? Number(raw) : raw; }, key);
    cap.classList.toggle("bad", !isPosInt(raw));
  });
  box.querySelector("#delItem").addEventListener("click", removeSelected);
}
function segment(host, options, current, onPick) {
  options.forEach(([value, text]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-pressed", String(value === current));
    b.addEventListener("click", () => onPick(value));
    host.appendChild(b);
  });
}
function renderHubInspector(box, h) {
  box.innerHTML = `
    <div class="head"><h2>Hub</h2><button class="btn" id="delItem" type="button">Delete</button></div>
    <label class="stack"><span class="label">Name</span><input type="text" class="mono" id="hubName" spellcheck="false" autocomplete="off"></label>
    <div class="row">
      <label class="stack"><span class="label">x</span><input type="number" class="mono" id="hubX" step="1"></label>
      <label class="stack"><span class="label">y</span><input type="number" class="mono" id="hubY" step="1"></label>
    </div>
    <div class="stack"><span class="label">Role</span><div class="seg" id="roleSeg"></div></div>
    <div class="stack"><span class="label">Zone</span><div class="seg" id="zoneSeg"></div></div>
    <label class="stack"><span class="label">max_drones</span><input type="number" class="mono" id="hubMax" min="1" step="1"></label>
    <p class="note" id="maxNote" hidden>Start and end hubs have no limit, so this isn't exported.</p>
    <div class="stack">
      <label class="label" for="hubColor">Color</label>
      <input type="text" class="mono" id="hubColor" spellcheck="false" autocomplete="off" placeholder="none">
      <div class="swatches" id="swatches"></div>
    </div>`;
  const q = (s) => box.querySelector(s);
  const name = q("#hubName"), x = q("#hubX"), y = q("#hubY"), max = q("#hubMax"), color = q("#hubColor");
  name.value = h.name; x.value = h.x; y.value = h.y; max.value = h.max; color.value = h.color;
  max.disabled = h.role !== "hub";
  q("#maxNote").hidden = h.role === "hub";
  const serial = ++keySerial;
  name.addEventListener("input", () => {
    mutate(() => { h.name = name.value.trim(); }, `name${serial}`);
    name.classList.toggle("bad", !h.name || /[-\s]/.test(h.name));
  });
  const coord = (input, prop) => input.addEventListener("input", () => {
    const raw = input.value;
    mutate(() => { h[prop] = isInt(raw) ? Number(raw) : raw; }, `${prop}${serial}`);
    input.classList.toggle("bad", !isInt(raw));
  });
  coord(x, "x"); coord(y, "y");
  max.addEventListener("input", () => {
    const raw = max.value;
    mutate(() => { h.max = isInt(raw) ? Number(raw) : raw; }, `max${serial}`);
    max.classList.toggle("bad", !isPosInt(raw));
  });
  color.addEventListener("input", () => {
    mutate(() => { h.color = color.value.trim(); }, `color${serial}`);
    color.classList.toggle("bad", /[\s\[\]=]/.test(color.value.trim()));
  });
  segment(q("#roleSeg"), [["hub", "Hub"], ["start", "Start"], ["end", "End"]], h.role, (role) => {
    mutate(() => {
      if (role !== "hub") state.hubs.forEach((o) => { if (o.role === role) o.role = "hub"; });
      h.role = role;
    });
    renderInspector();
  });
  segment(q("#zoneSeg"), [["normal", "Normal"], ["priority", "Priority"], ["restricted", "Restricted"], ["blocked", "Blocked"]], h.zone, (zone) => {
    mutate(() => { h.zone = zone; });
    renderInspector();
  });
  const swatches = q("#swatches");
  const none = document.createElement("button");
  none.type = "button"; none.className = "swatch none"; none.textContent = "∅";
  none.setAttribute("aria-label", "No color"); none.title = "No color";
  none.addEventListener("click", () => { mutate(() => { h.color = ""; }); renderInspector(); });
  swatches.appendChild(none);
  COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "swatch"; b.style.background = shade(c); b.title = c;
    b.setAttribute("aria-label", c);
    b.addEventListener("click", () => { mutate(() => { h.color = c; }); renderInspector(); });
    swatches.appendChild(b);
  });
  q("#delItem").addEventListener("click", removeSelected);
}
function renderChecks() {
  const { errors, warnings, route } = lastChecks;
  const list = $("checks");
  list.replaceChildren();
  const add = (sev, word, c) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    if (c.ref) { b.className = "link"; b.addEventListener("click", () => select(c.ref)); } else { b.tabIndex = -1; }
    const s = document.createElement("span");
    s.className = `sev ${sev}`; s.textContent = word;
    const t = document.createElement("span");
    t.textContent = c.msg;
    b.append(s, t);
    li.appendChild(b);
    list.appendChild(li);
  };
  errors.forEach((c) => add("err", "Error", c));
  warnings.forEach((c) => add("warn", "Check", c));
  list.hidden = !errors.length && !warnings.length;
  const v = $("verdict");
  if (errors.length) { v.className = "pill err"; v.textContent = `${errors.length} error${errors.length > 1 ? "s" : ""}`; }
  else if (warnings.length) { v.className = "pill warn"; v.textContent = "Valid, see notes"; }
  else { v.className = "pill ok"; v.textContent = "Valid map"; }
  $("statHubs").textContent = state.hubs.length;
  $("statLinks").textContent = state.conns.length;
  $("statTurns").textContent = route ? route.turns : "–";
  $("routeText").textContent = route ? route.path.map((id) => findHub(id).name).join(" → ") : "";
  $("routeText").hidden = !route;
}
function syncTop() {
  $("mapTitle").value = state.title || "";
  $("nbDrones").value = state.nb;
  $("nbDrones").classList.toggle("bad", !isPosInt(state.nb));
}
function refresh() {
  lastChecks = checkMap(state);
  $("output").value = serialize(state);
  $("undo").disabled = !undoStack.length;
  $("redo").disabled = !redoStack.length;
  renderChart();
  renderChecks();
  saveDraft();
}

/* ---------- pointer ---------- */
svg.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const p = local(e);
  const hub = hubAt(p);
  const connEl = e.target.closest && e.target.closest("[data-conn]");
  const panFrom = { type: "pan", sx: p.x, sy: p.y, cx: view.cx, cy: view.cy, moved: false };
  svg.setPointerCapture(e.pointerId);
  if (tool === "link") {
    if (hub) {
      if (linkFrom !== null && linkFrom !== hub.id) { const from = linkFrom; linkFrom = null; rubber = null; addLink(from, hub.id); gesture = null; return; }
      linkFrom = hub.id; rubber = p;
      gesture = { type: "link", from: hub.id, sx: p.x, sy: p.y, moved: false };
      renderChart();
      return;
    }
    linkFrom = null; rubber = null;
    gesture = panFrom;
    renderChart();
    return;
  }
  if (hub) {
    select({ type: "hub", id: hub.id });
    gesture = { type: "drag", id: hub.id, key: `drag${++keySerial}` };
    return;
  }
  if (connEl && tool === "select") { select({ type: "conn", id: Number(connEl.dataset.conn) }); gesture = null; return; }
  gesture = { ...panFrom, place: tool === "hub", clear: tool === "select" };
});
svg.addEventListener("pointermove", (e) => {
  const p = local(e);
  const w = toWorld(p.x, p.y);
  $("cursor").textContent = `x ${Math.round(w.x)}  y ${Math.round(w.y)}`;
  if (linkFrom !== null) { rubber = p; if (!gesture) renderChart(); }
  if (!gesture) return;
  if (gesture.type === "pan") {
    if (Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 4) gesture.moved = true;
    if (gesture.moved) {
      view.cx = gesture.cx - (p.x - gesture.sx) / view.k;
      view.cy = gesture.cy + (p.y - gesture.sy) / view.k;
      renderChart();
    }
  } else if (gesture.type === "drag") {
    const h = findHub(gesture.id);
    const x = Math.round(w.x), y = Math.round(w.y);
    if (h && (h.x !== x || h.y !== y)) {
      mutate(() => { h.x = x; h.y = y; }, gesture.key);
      const fx = $("hubX"), fy = $("hubY");
      if (fx) fx.value = x;
      if (fy) fy.value = y;
    }
  } else if (gesture.type === "link") {
    if (Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 6) gesture.moved = true;
    renderChart();
  }
});
function endGesture(e) {
  const g = gesture;
  gesture = null;
  if (!g) return;
  const p = local(e);
  if (g.type === "link" && g.moved) {
    const target = hubAt(p);
    linkFrom = null; rubber = null;
    if (target && target.id !== g.from) addLink(g.from, target.id);
    else renderChart();
  } else if (g.type === "pan" && !g.moved) {
    if (g.place) {
      const w = toWorld(p.x, p.y);
      addHub(Math.round(w.x), Math.round(w.y));
    } else if (g.clear) select(null);
  }
}
svg.addEventListener("pointerup", endGesture);
svg.addEventListener("pointercancel", () => { gesture = null; linkFrom = null; rubber = null; renderChart(); });
svg.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(local(e), e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

/* ---------- controls ---------- */
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
$("undo").addEventListener("click", () => restore(undoStack, redoStack));
$("redo").addEventListener("click", () => restore(redoStack, undoStack));
$("zoomIn").addEventListener("click", () => { const { w, h } = size(); zoomAt({ x: w / 2, y: h / 2 }, 1.25); });
$("zoomOut").addEventListener("click", () => { const { w, h } = size(); zoomAt({ x: w / 2, y: h / 2 }, 0.8); });
$("fit").addEventListener("click", fitView);
$("newMap").addEventListener("click", () => {
  mutate(() => { state = { title: "", nb: 1, hubs: [], conns: [], nextId: 1 }; });
  selection = null;
  syncTop(); renderInspector(); fitView();
  setTool("hub");
  say("New map started. Undo brings the old one back.");
});
const titleKey = "title";
$("mapTitle").addEventListener("input", () => { const v = $("mapTitle").value; mutate(() => { state.title = v; }, titleKey); });
$("mapTitle").addEventListener("blur", () => { lastKey = null; });
$("nbDrones").addEventListener("input", () => {
  const raw = $("nbDrones").value;
  mutate(() => { state.nb = isInt(raw) ? Number(raw) : raw; }, "nb");
  $("nbDrones").classList.toggle("bad", !isPosInt(raw));
});
$("nbDrones").addEventListener("blur", () => { lastKey = null; });

window.addEventListener("keydown", (e) => {
  const typing = e.target.matches && e.target.matches("input, textarea, select");
  if (e.key === "Escape") {
    if (!$("importModal").hidden) { closeImport(); return; }
    linkFrom = null; rubber = null;
    if (!typing) select(null);
    return;
  }
  if (!$("importModal").hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("save").hidden) $("save").click(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); openImport(); return; }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); restore(e.shiftKey ? redoStack : undoStack, e.shiftKey ? undoStack : redoStack); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); restore(redoStack, undoStack); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "v") setTool("select");
  else if (k === "h") setTool("hub");
  else if (k === "l") setTool("link");
  else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelected(); }
  else if (e.key.startsWith("Arrow") && selection && selection.type === "hub") {
    e.preventDefault();
    const h = findSelected();
    const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    const dy = e.key === "ArrowDown" ? -1 : e.key === "ArrowUp" ? 1 : 0;
    mutate(() => { h.x = (Number(h.x) || 0) + dx; h.y = (Number(h.y) || 0) + dy; });
    renderInspector();
  }
});

/* ---------- map file ---------- */
function fileName() {
  const slug = (state.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || "flyin_map"}.txt`;
}
$("copy").addEventListener("click", () => {
  const out = $("output");
  const fallback = () => { out.focus(); out.select(); say("Press Ctrl+C to copy the selected text."); };
  if (!navigator.clipboard) { fallback(); return; }
  navigator.clipboard.writeText(out.value).then(() => say("Copied the map file."), fallback);
});
let downloads = null;
$("save").addEventListener("click", async () => {
  const data = $("output").value;
  const filename = fileName();
  if (!downloads) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  try {
    await downloads.save({ filename, data });
    say(`Saved ${filename}.`);
  } catch (err) {
    if (err && err.code === "declined") say("Save cancelled.");
    else if (err && err.code === "rate_limited") say("A save prompt is already open.");
    else { say("Saving isn't available here. Use Copy instead."); $("save").hidden = true; }
  }
});
if (window.claude && window.claude.use) {
  window.claude.use("downloads").then((d) => { downloads = d; $("save").hidden = !d; });
} else {
  $("save").hidden = false;
}

let importTitle = "";
function openImport() { $("importError").hidden = true; $("importModal").hidden = false; $("importText").focus(); }
function closeImport() { $("importModal").hidden = true; $("importFile").value = ""; importTitle = ""; }
/* Loads straight away when the text is valid. Otherwise it opens the dialog with the text and the reason. */
function loadMapText(text, title) {
  const res = parseMap(text);
  if (!res.ok) {
    importTitle = title;
    $("importText").value = text;
    openImport();
    const err = $("importError");
    err.textContent = res.line ? `Line ${res.line}: ${res.msg}.` : `This map can't load: ${res.msg}.`;
    err.hidden = false;
    return;
  }
  if (!res.map.title) res.map.title = title;
  mutate(() => { state = res.map; });
  selection = null;
  $("importText").value = "";
  closeImport();
  syncTop(); renderInspector(); setTool("select"); fitView();
  const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  say(`Imported ${count(state.hubs.length, "hub")} and ${count(state.conns.length, "connection")}.`);
}
function readMapFile(file) {
  if (file.size > 1e6) { say(`${file.name} is too large to be a map file.`); return; }
  const reader = new FileReader();
  reader.onload = () => loadMapText(String(reader.result), file.name.replace(/\.[^.]*$/, ""));
  reader.onerror = () => say(`Couldn't read ${file.name}.`);
  reader.readAsText(file);
}
$("openImport").addEventListener("click", openImport);
$("importCancel").addEventListener("click", closeImport);
$("importFile").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) readMapFile(file);
});
$("importGo").addEventListener("click", () => loadMapText($("importText").value, importTitle));

const hasFile = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
window.addEventListener("dragover", (e) => {
  if (!hasFile(e)) return;
  e.preventDefault();
  document.body.classList.add("dropping");
});
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
window.addEventListener("drop", (e) => {
  document.body.classList.remove("dropping");
  if (!hasFile(e)) return;
  e.preventDefault();
  if (e.dataTransfer.files[0]) readMapFile(e.dataTransfer.files[0]);
});
document.addEventListener("paste", (e) => {
  if (!$("importModal").hidden || (e.target.matches && e.target.matches("input, textarea, select"))) return;
  const text = e.clipboardData && e.clipboardData.getData("text");
  if (text && text.trim()) { e.preventDefault(); loadMapText(text, ""); }
});

/* ---------- start ---------- */
const hadDraft = loadDraft();
syncTop();
renderInspector();
refresh();
setTool("select");
fitView();
say(hadDraft ? "Restored your last map. Press New to start empty." : "This is an example map. Edit it, press New to start empty, or drop a .txt file to open it.", false);
new ResizeObserver(() => renderChart()).observe(svg);
