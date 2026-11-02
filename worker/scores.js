// Boredom Blaster global high scores: a Cloudflare Worker with one KV namespace bound as SCORES.
//   GET  /top     -> { scores: [ { initials, score, wave, date } x up to 10 ] }
//   POST /start   -> { ticket }: a run ticket signed with the server's clock (HMAC, nothing stored)
//   POST /submit  -> body { initials, score, wave, seconds, ticket } (JSON, max 200 bytes)
//   POST /event   -> body { world, wave, seconds, score, end, device, ticket } (one finished run, no id): only added
//                    into daily counters "st:YYYY-MM-DD" with the Cloudflare country; nothing per player is kept
//   GET  /stats?days=30 -> those daily counters; needs "Authorization: Bearer <STATS_KEY>" (owner secret)
// Scores and run lines are only taken with a valid ticket, each ticket once per kind, and every claim is
// checked against the time the server itself measured since /start: a forged body cannot claim a longer
// run, a further wave or a bigger score than the real time since the ticket allows.
// scripts/deploy-scores.sh uploads src/scores.js in front of this file, so BBScores (cleanInitials,
// plausible, insert) is the very same code the game uses. Tests load src/scores.js first.
const ORIGIN = "https://maumoya.github.io";
const MAX_BODY = 200; // bytes
const LIMIT = 5; // submits per client per window
const WINDOW_SECONDS = 600; // 10 minutes
const TOP_KEY = "top";
const EVENT_LIMIT = 30; // run lines per client per window
const STATS_TTL = 400 * 86400; // daily counters expire after ~13 months
const DEVICES = ["phone", "tablet", "desktop"];
const TICKET_MAX_SECONDS = 3 * 3600; // a ticket older than 3 hours is refused
const CLOCK_SLACK_SECONDS = 15; // network and pause rounding between the game's count and the server's
const MIN_WAVE_SECONDS = 1; // no wave can be cleared faster (a kaboom on spawn); wave <= 1 + elapsed / this
const ENDS = ["over", "quit"];

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

function corsHeaders(request) {
  if (request.headers.get("Origin") !== ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

async function readTop(env) {
  try {
    const list = JSON.parse((await env.SCORES.get(TOP_KEY)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

// one-way hash of the caller's address, used only as a short-lived rate-limit key (expires with the window)
async function clientKey(request, prefix = "rl:") {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("bb-rl:" + ip));
  return prefix + [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// true when this client may submit now (and counts the submit)
async function allowSubmit(request, env, now, prefix = "rl:", limit = LIMIT) {
  const key = await clientKey(request, prefix);
  let state = null;
  try { state = JSON.parse(await env.SCORES.get(key)); } catch (e) { /* none */ }
  if (!state || !(now - state.start < WINDOW_SECONDS * 1000)) state = { start: now, count: 0 };
  if (state.count >= limit) return false;
  state.count += 1;
  const left = Math.max(60, Math.ceil((state.start + WINDOW_SECONDS * 1000 - now) / 1000)); // KV minimum is 60 s
  await env.SCORES.put(key, JSON.stringify(state), { expirationTtl: left });
  return true;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// HMAC-SHA256 of "run:<t>" with the owner's STATS_KEY secret; null when the Worker has no secret
async function sign(env, t) {
  if (!env.STATS_KEY) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("bb-ticket:" + env.STATS_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("run:" + t));
  return b64url(new Uint8Array(mac)).slice(0, 27);
}

// "<t>.<sig>" -> seconds the server has seen since t, or null when forged, from the future or too old
async function ticketSeconds(env, ticket, now) {
  const m = /^(\d{13})\.([A-Za-z0-9_-]{27})$/.exec(typeof ticket === "string" ? ticket : "");
  if (!m) return null;
  const t = Number(m[1]), want = await sign(env, t);
  if (!want || want !== m[2] || t > now) return null;
  const elapsed = (now - t) / 1000;
  return elapsed <= TICKET_MAX_SECONDS ? elapsed : null;
}

// the run's claims fit the time the server measured: seconds, wave and score
function fitsTicket(elapsed, wave, seconds, score) {
  const s = Math.min(seconds, elapsed + CLOCK_SLACK_SECONDS);
  return seconds <= elapsed + CLOCK_SLACK_SECONDS && wave <= 1 + Math.floor(s / MIN_WAVE_SECONDS)
    && globalThis.BBScores.plausible(score, wave, s);
}

// true the first time this ticket is used for this kind (submit or event); remembers it until it expires
async function firstUse(env, kind, ticket) {
  const key = "tk:" + kind + ":" + ticket.slice(-27);
  if (await env.SCORES.get(key)) return false;
  await env.SCORES.put(key, "1", { expirationTtl: TICKET_MAX_SECONDS });
  return true;
}

async function start(env, now, cors) {
  const sig = await sign(env, now);
  if (!sig) return json({ error: "no tickets" }, 503, cors);
  return json({ ticket: now + "." + sig }, 200, { ...cors, "Cache-Control": "no-store" });
}

async function submit(request, env, now, cors) {
  const BBS = globalThis.BBScores;
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_BODY) return json({ error: "too big" }, 413, cors);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return json({ error: "too big" }, 413, cors);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: "not json" }, 400, cors); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "not an object" }, 400, cors);

  const { score, wave, seconds } = body;
  const whole = (v) => Number.isInteger(v);
  if (!whole(score) || !whole(wave) || !whole(seconds) || score <= 0 || !BBS.plausible(score, wave, seconds)) {
    return json({ error: "implausible" }, 422, cors);
  }
  const elapsed = await ticketSeconds(env, body.ticket, now);
  if (elapsed === null) return json({ error: "no valid ticket" }, 403, cors);
  if (!fitsTicket(elapsed, wave, seconds, score)) return json({ error: "implausible" }, 422, cors);
  if (!(await allowSubmit(request, env, now))) return json({ error: "slow down" }, 429, cors);
  if (!(await firstUse(env, "sub", body.ticket))) return json({ error: "ticket used" }, 409, cors);

  const entry = { initials: BBS.cleanInitials(body.initials), score, wave, date: now }; // only these four are stored
  const list = await readTop(env);
  const result = BBS.insert(list, entry);
  if (result.index >= 0) await env.SCORES.put(TOP_KEY, JSON.stringify(result.list));
  return json({ ok: true, rank: result.index >= 0 ? result.index + 1 : null }, 200, cors);
}

async function readBody(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_BODY) return { error: json({ error: "too big" }, 413) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return { error: json({ error: "too big" }, 413) };
  try {
    const body = JSON.parse(raw);
    return body && typeof body === "object" && !Array.isArray(body) ? { body } : { error: json({ error: "not an object" }, 400) };
  } catch (e) { return { error: json({ error: "not json" }, 400) }; }
}

const day = (now) => new Date(now).toISOString().slice(0, 10);
const bump = (obj, key, by = 1) => { obj[key] = (obj[key] || 0) + by; };

async function event(request, env, now, cors) {
  const read = await readBody(request);
  if (read.error) return new Response(read.error.body, { status: read.error.status, headers: { "Content-Type": "application/json", ...cors } });
  const { world, wave, seconds, score, end, device } = read.body;
  const whole = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!whole(world, 1000) || !whole(wave, 100000) || !whole(seconds, 86400) || !whole(score, 1e9)
      || !ENDS.includes(end) || !DEVICES.includes(device)) return json({ error: "bad event" }, 422, cors);
  const elapsed = await ticketSeconds(env, read.body.ticket, now);
  if (elapsed === null) return json({ error: "no valid ticket" }, 403, cors);
  if (!fitsTicket(elapsed, wave, seconds, score)) return json({ error: "bad event" }, 422, cors);
  if (!(await allowSubmit(request, env, now, "rl-ev:", EVENT_LIMIT))) return json({ error: "slow down" }, 429, cors);
  if (!(await firstUse(env, "ev", read.body.ticket))) return json({ error: "ticket used" }, 409, cors);
  const country = String((request.cf && request.cf.country) || "XX").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "XX";
  const key = "st:" + day(now);
  let st = null;
  try { st = JSON.parse(await env.SCORES.get(key)); } catch (e) { /* none */ }
  if (!st || typeof st !== "object") st = { runs: 0, seconds: 0, score: 0, bestWave: 0, countries: {}, devices: {}, waves: {}, worlds: {}, ends: {} };
  st.runs += 1;
  st.seconds += seconds;
  st.score += score;
  st.bestWave = Math.max(st.bestWave, wave);
  bump(st.countries, country);
  bump(st.devices, device);
  bump(st.waves, String(Math.floor((wave - 1) / 10) * 10 + 1)); // runs that ended in waves 1-10, 11-20, ...
  bump(st.worlds, String(world));
  bump(st.ends, end);
  await env.SCORES.put(key, JSON.stringify(st), { expirationTtl: STATS_TTL });
  return json({ ok: true }, 200, cors);
}

async function stats(request, env, now) {
  const want = env.STATS_KEY ? "Bearer " + env.STATS_KEY : null;
  if (!want || request.headers.get("Authorization") !== want) return json({ error: "forbidden" }, 403, {});
  const n = Math.min(400, Math.max(1, parseInt(new URL(request.url).searchParams.get("days"), 10) || 30));
  const days = [];
  for (let i = 0; i < n; i++) {
    const key = day(now - i * 86400000);
    let st = null;
    try { st = JSON.parse(await env.SCORES.get("st:" + key)); } catch (e) { /* none */ }
    if (st) days.push({ day: key, ...st });
  }
  return json({ days }, 200, { "Cache-Control": "no-store" });
}

// handle(request, env, now): the whole Worker; `now` is only injected by tests
export async function handle(request, env, now = Date.now()) {
  const cors = corsHeaders(request);
  const path = new URL(request.url).pathname;
  if (request.method === "OPTIONS") {
    return cors["Access-Control-Allow-Origin"] ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
  }
  if (path === "/top" && request.method === "GET") {
    return json({ scores: await readTop(env) }, 200, { ...cors, "Cache-Control": "public, max-age=30" });
  }
  if (path === "/start" && request.method === "POST") return start(env, now, cors);
  if (path === "/submit" && request.method === "POST") return submit(request, env, now, cors);
  if (path === "/event" && request.method === "POST") return event(request, env, now, cors);
  if (path === "/stats" && request.method === "GET") return stats(request, env, now);
  if (["/top", "/start", "/submit", "/event", "/stats"].includes(path)) return json({ error: "method not allowed" }, 405, cors);
  return json({ error: "not found" }, 404, cors);
}

export default { fetch: (request, env) => handle(request, env) };
