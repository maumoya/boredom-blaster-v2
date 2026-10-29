// Boredom Blaster global high scores, client side: fetch the top table and submit a score.
// Plain script like scores.js (load it after scores.js). An empty API address means offline: nothing is ever sent.
(function (root) {
  const API = "https://boredom-blaster-scores.maumoya85.workers.dev"; // address of the deployed scores Worker, e.g. "https://boredom-blaster-scores.NAME.workers.dev"
  const TIMEOUT_MS = 3000;

  // a table from the server, cleaned like the local one; anything odd is dropped
  function cleanList(data) {
    const list = data && Array.isArray(data.scores) ? data.scores : [];
    return list
      .filter((s) => s && typeof s.score === "number" && Number.isFinite(s.score) && s.score > 0)
      .slice(0, root.BBScores.MAX)
      .map((s) => ({
        initials: root.BBScores.cleanInitials(s.initials), score: Math.floor(s.score),
        wave: Math.max(1, Math.floor(Number(s.wave)) || 1), date: Number(s.date) || 0,
      }));
  }

  // opts: { api, fetch, timeoutMs, setTimeout, clearTimeout }; every call resolves, it never rejects
  function createClient(opts) {
    opts = opts || {};
    const api = String(opts.api === undefined ? API : opts.api || "").replace(/\/+$/, "");
    const doFetch = opts.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    const setT = opts.setTimeout || root.setTimeout, clearT = opts.clearTimeout || root.clearTimeout;
    const enabled = !!api && !!doFetch;

    // fetch with a hard time limit; resolves to the parsed JSON body or throws
    function call(path, init) {
      let timer;
      const limit = new Promise((_, reject) => { timer = setT(() => reject(new Error("timeout")), timeoutMs); });
      const request = Promise.resolve().then(() => doFetch(api + path, init)).then((res) => {
        if (!res || !res.ok) throw new Error("http " + (res && res.status));
        return res.json();
      });
      return Promise.race([request, limit]).finally(() => clearT(timer));
    }

    return {
      enabled,
      // a run ticket from the server, or null (offline, refused, slow); without one nothing is sent for the run
      async start() {
        if (!enabled) return null;
        try {
          const r = await call("/start", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "" });
          return r && typeof r.ticket === "string" ? r.ticket : null;
        } catch (e) { return null; }
      },
      async fetchTop() {
        if (!enabled) return { ok: false, offline: true, list: [] };
        try { return { ok: true, list: cleanList(await call("/top")) }; } catch (e) { return { ok: false, list: [] }; }
      },
      // entry: { initials, score, wave, seconds, ticket }; seconds and the ticket are only used by the server's checks
      async submit(entry) {
        if (!enabled) return { ok: false, offline: true };
        if (!entry.ticket) return { ok: false, noTicket: true };
        if (!root.BBScores.plausible(entry.score, entry.wave, entry.seconds)) return { ok: false, implausible: true };
        const body = JSON.stringify({
          initials: root.BBScores.cleanInitials(entry.initials), score: Math.floor(entry.score),
          wave: Math.floor(entry.wave), seconds: Math.floor(entry.seconds), ticket: String(entry.ticket),
        });
        try {
          await call("/submit", { method: "POST", headers: { "Content-Type": "text/plain" }, body });
          return { ok: true };
        } catch (e) { return { ok: false }; }
      },
    };
  }

  root.BBScoresNet = { API, TIMEOUT_MS, createClient, cleanList };
})(globalThis);
