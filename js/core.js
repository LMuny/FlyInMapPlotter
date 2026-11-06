/* Map logic with no page access: read, write and check the Fly-in format. */
const ZONES = ["normal", "blocked", "restricted", "priority"];
const META_ERR = (line, msg) => ({ ok: false, line, msg });
const isInt = (v) => /^[+-]?\d+$/.test(String(v).trim());
const isPosInt = (v) => isInt(v) && Number(v) > 0;

function parseMeta(text, allowed, ignored) {
  if (!(text.startsWith("[") && text.endsWith("]"))) return { error: "metadata must be inside [...]" };
  const out = {};
  for (const tag of text.slice(1, -1).split(/\s+/).filter(Boolean)) {
    const at = tag.indexOf("=");
    const key = at < 0 ? tag : tag.slice(0, at);
    const value = at < 0 ? "" : tag.slice(at + 1);
    if (!key || !value) return { error: `'${tag}' should be key=value` };
    if (ignored.includes(key)) continue;
    if (!allowed.includes(key)) return { error: `unknown metadata tag '${key}'` };
    if (key in out) return { error: `tag '${key}' is given twice` };
    if ((key === "max_drones" || key === "max_link_capacity") && !isPosInt(value)) return { error: `${key} must be a positive integer` };
    if (key === "zone" && !ZONES.includes(value)) return { error: `zone must be one of ${ZONES.join(", ")}` };
    out[key] = value;
  }
  return { meta: out };
}

function parseMap(text) {
  const lines = [];
  let title = "";
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("#") && !lines.length && !title) title = line.replace(/^#+\s*/, "");
    if (line && !line.startsWith("#")) lines.push([i + 1, line]);
  });
  if (!lines.length) return META_ERR(null, "the map is empty");
  const [firstNo, first] = lines[0];
  const firstAt = first.indexOf(":");
  if (firstAt < 0 || first.slice(0, firstAt).trim() !== "nb_drones") return META_ERR(firstNo, "the first line must be nb_drones: <number>");
  const nb = first.slice(firstAt + 1).trim();
  if (!isPosInt(nb)) return META_ERR(firstNo, "nb_drones must be a positive integer");

  const map = { title, nb: Number(nb), hubs: [], conns: [], nextId: 1 };
  const byName = new Map();
  const pairs = new Set();
  let hasStart = false, hasEnd = false;
  for (const [no, line] of lines.slice(1)) {
    const at = line.indexOf(":");
    const prefix = (at < 0 ? line : line.slice(0, at)).trim();
    const rest = at < 0 ? "" : line.slice(at + 1).trim();
    if (prefix === "start_hub" || prefix === "end_hub" || prefix === "hub") {
      const m = rest.match(/^(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
      if (!m) return META_ERR(no, "expected <name> <x> <y> [metadata]");
      const [, name, x, y, metaText] = m;
      if (name.includes("-")) return META_ERR(no, `hub name '${name}' must not contain a dash`);
      if (byName.has(name)) return META_ERR(no, `duplicate hub name '${name}'`);
      if (!isInt(x) || !isInt(y)) return META_ERR(no, "x and y must be integers");
      const role = prefix === "start_hub" ? "start" : prefix === "end_hub" ? "end" : "hub";
      if (role === "start" && hasStart) return META_ERR(no, "there must be exactly one start_hub");
      if (role === "end" && hasEnd) return META_ERR(no, "there must be exactly one end_hub");
      hasStart = hasStart || role === "start";
      hasEnd = hasEnd || role === "end";
      const parsed = metaText ? parseMeta(metaText, ["zone", "color", "max_drones"], role === "hub" ? [] : ["max_drones"]) : { meta: {} };
      if (parsed.error) return META_ERR(no, parsed.error);
      const hub = { id: map.nextId++, name, x: Number(x), y: Number(y), role,
        zone: parsed.meta.zone || "normal", color: parsed.meta.color || "", max: Number(parsed.meta.max_drones || 1) };
      map.hubs.push(hub);
      byName.set(name, hub);
    } else if (prefix === "connection") {
      const m = rest.match(/^(\S+)(?:\s+(.*))?$/);
      if (!m) return META_ERR(no, "expected <hub_a>-<hub_b> [metadata]");
      const dash = m[1].indexOf("-");
      if (dash < 0) return META_ERR(no, "expected <hub_a>-<hub_b>");
      const a = m[1].slice(0, dash), b = m[1].slice(dash + 1);
      for (const n of [a, b]) if (!byName.has(n)) return META_ERR(no, `hub '${n}' is not defined before this line`);
      if (a === b) return META_ERR(no, `hub '${a}' can't connect to itself`);
      const key = [a, b].sort().join("\n");
      if (pairs.has(key)) return META_ERR(no, `duplicate connection '${a}-${b}'`);
      pairs.add(key);
      const parsed = m[2] ? parseMeta(m[2], ["max_link_capacity"], []) : { meta: {} };
      if (parsed.error) return META_ERR(no, parsed.error);
      map.conns.push({ id: map.nextId++, a: byName.get(a).id, b: byName.get(b).id, cap: Number(parsed.meta.max_link_capacity || 1) });
    } else {
      return META_ERR(no, `unknown line type '${prefix}'`);
    }
  }
  if (!hasStart) return META_ERR(null, "the map has no start_hub");
  if (!hasEnd) return META_ERR(null, "the map has no end_hub");
  return { ok: true, map };
}

function hubLine(h) {
  const tags = [];
  if (h.zone !== "normal") tags.push(`zone=${h.zone}`);
  if (h.color) tags.push(`color=${h.color}`);
  if (h.role === "hub" && String(h.max) !== "1") tags.push(`max_drones=${h.max}`);
  const prefix = h.role === "start" ? "start_hub" : h.role === "end" ? "end_hub" : "hub";
  return `${prefix}: ${h.name} ${h.x} ${h.y}${tags.length ? ` [${tags.join(" ")}]` : ""}`;
}

function serialize(map) {
  const out = [];
  if (map.title && map.title.trim()) out.push(`# ${map.title.trim()}`);
  out.push(`nb_drones: ${map.nb}`, "");
  const rank = { start: 0, hub: 1, end: 2 };
  const hubs = [...map.hubs].sort((p, q) => rank[p.role] - rank[q.role]);
  hubs.forEach((h) => out.push(hubLine(h)));
  if (map.conns.length) out.push("");
  const byId = new Map(map.hubs.map((h) => [h.id, h]));
  map.conns.forEach((c) => {
    const cap = String(c.cap) !== "1" ? ` [max_link_capacity=${c.cap}]` : "";
    out.push(`connection: ${byId.get(c.a).name}-${byId.get(c.b).name}${cap}`);
  });
  return out.join("\n") + "\n";
}

/* Cheapest route from start to end. Priority zones win ties, as the subject asks. */
function shortestRoute(map) {
  const start = map.hubs.find((h) => h.role === "start");
  const end = map.hubs.find((h) => h.role === "end");
  if (!start || !end || start.zone === "blocked" || end.zone === "blocked") return null;
  const near = new Map(map.hubs.map((h) => [h.id, []]));
  const byId = new Map(map.hubs.map((h) => [h.id, h]));
  map.conns.forEach((c) => { near.get(c.a).push(c.b); near.get(c.b).push(c.a); });
  const WEIGHT = 1000;
  const dist = new Map([[start.id, 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let cur = null;
    dist.forEach((d, id) => { if (!done.has(id) && (cur === null || d < dist.get(cur))) cur = id; });
    if (cur === null) return null;
    if (cur === end.id) break;
    done.add(cur);
    for (const next of near.get(cur)) {
      const h = byId.get(next);
      if (h.zone === "blocked" || done.has(next)) continue;
      const step = (h.zone === "restricted" ? 2 : 1) * WEIGHT - (h.zone === "priority" ? 1 : 0);
      const total = dist.get(cur) + step;
      if (!dist.has(next) || total < dist.get(next)) { dist.set(next, total); prev.set(next, cur); }
    }
  }
  const path = [end.id];
  while (path[0] !== start.id) path.unshift(prev.get(path[0]));
  return { path, turns: Math.ceil(dist.get(end.id) / WEIGHT) };
}

function reachableFromStart(map, start) {
  const seen = new Set([start.id]);
  const blocked = new Set(map.hubs.filter((h) => h.zone === "blocked").map((h) => h.id));
  const queue = [start.id];
  while (queue.length) {
    const cur = queue.pop();
    for (const c of map.conns) {
      const next = c.a === cur ? c.b : c.b === cur ? c.a : null;
      if (next !== null && !seen.has(next) && !blocked.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

/* errors: your parser must reject the file. warnings: the file is valid but worth a look. */
function checkMap(map) {
  const errors = [], warnings = [];
  const hubRef = (h) => ({ type: "hub", id: h.id });
  if (!isPosInt(map.nb)) errors.push({ msg: "nb_drones must be a positive integer." });
  const starts = map.hubs.filter((h) => h.role === "start");
  const ends = map.hubs.filter((h) => h.role === "end");
  if (starts.length !== 1) errors.push({ msg: starts.length ? "There must be only one start hub." : "Set one hub as Start." });
  if (ends.length !== 1) errors.push({ msg: ends.length ? "There must be only one end hub." : "Set one hub as End." });
  const names = new Map();
  map.hubs.forEach((h) => {
    const label = h.name || "(unnamed)";
    if (!h.name) errors.push({ msg: "A hub has no name.", ref: hubRef(h) });
    else if (/[-\s]/.test(h.name)) errors.push({ msg: `'${label}': names can't contain dashes or spaces.`, ref: hubRef(h) });
    if (h.name && names.has(h.name)) errors.push({ msg: `'${label}': this name is already used.`, ref: hubRef(h) });
    names.set(h.name, h);
    if (!isInt(h.x) || !isInt(h.y)) errors.push({ msg: `'${label}': x and y must be integers.`, ref: hubRef(h) });
    if (h.role === "hub" && !isPosInt(h.max)) errors.push({ msg: `'${label}': max_drones must be a positive integer.`, ref: hubRef(h) });
    if (h.color && /[\s\[\]=]/.test(h.color)) errors.push({ msg: `'${label}': color must be one word.`, ref: hubRef(h) });
    if (h.zone === "blocked" && h.role !== "hub") warnings.push({ msg: `'${label}': a blocked ${h.role} hub makes the map unsolvable.`, ref: hubRef(h) });
  });
  const byId = new Map(map.hubs.map((h) => [h.id, h]));
  const pairs = new Set();
  map.conns.forEach((c) => {
    const ref = { type: "conn", id: c.id };
    const key = [c.a, c.b].sort().join("-");
    if (pairs.has(key)) errors.push({ msg: "A connection appears twice.", ref });
    pairs.add(key);
    if (!isPosInt(c.cap)) errors.push({ msg: `${byId.get(c.a).name}-${byId.get(c.b).name}: max_link_capacity must be a positive integer.`, ref });
  });
  const spots = new Map();
  map.hubs.forEach((h) => {
    const key = `${h.x},${h.y}`;
    if (spots.has(key)) warnings.push({ msg: `'${h.name}' and '${spots.get(key).name}' share the point (${key}).`, ref: hubRef(h) });
    else spots.set(key, h);
  });
  const route = starts.length === 1 && ends.length === 1 ? shortestRoute(map) : null;
  if (starts.length === 1 && ends.length === 1 && !route) {
    warnings.push({ msg: "No path links start to end. This parses, but your program must report it clearly." });
  }
  if (starts.length === 1) {
    const seen = reachableFromStart(map, starts[0]);
    map.hubs.forEach((h) => {
      if (!seen.has(h.id) && h.zone !== "blocked" && h.role !== "end") warnings.push({ msg: `'${h.name}' can't be reached from start.`, ref: hubRef(h) });
    });
  }
  return { errors, warnings, route };
}
