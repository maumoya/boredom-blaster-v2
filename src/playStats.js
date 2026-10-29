// Boredom Blaster play stats. Two parts:
//  - local: times played and time played on this device (localStorage), shown on the title screen;
//  - shared: one anonymous line per finished run sent to the scores Worker (/event), so the owner can see
//    where runs end and tune the game. No id, no initials, no address is sent: the Worker stores only daily
//    counters (country comes from Cloudflare, never from the game). Do Not Track or Global Privacy Control
//    turns the shared part off. Plain script; read globalThis.BBPlayStats.
(function (root) {
  const KEY = "bb.playStats";
  const MIN_SECONDS = 5; // shorter runs (a mis-tap on START) are not counted
  const DEVICES = ["phone", "tablet", "desktop"];

  // true when the browser asks not to be tracked
  function optedOut(nav) {
    nav = nav || root.navigator || {};
    return nav.doNotTrack === "1" || nav.globalPrivacyControl === true || root.doNotTrack === "1";
  }

  function deviceOf(w, h, touch) {
    const short = Math.min(w || 0, h || 0);
    if (!touch) return "desktop";
    return short < 600 ? "phone" : "tablet";
  }

  // the line sent for one run; every field a small whole number or a fixed word
  function runEvent(game, seconds, end, device) {
    const E = root.BBEnemies;
    const wave = Math.max(1, Math.floor(game.wave) || 1);
    return {
      world: E && E.worldIndex ? E.worldIndex(wave) + 1 : 1,
      wave,
      seconds: Math.max(0, Math.round(seconds)),
      score: Math.max(0, Math.floor(game.score) || 0),
      end: end === "quit" ? "quit" : "over",
      device: DEVICES.includes(device) ? device : "desktop",
    };
  }

  // local counters: { runs, seconds }
  function createLocal(storage) {
    const read = () => {
      try {
        const v = storage ? JSON.parse(storage.getItem(KEY)) : null;
        return v && Number.isFinite(v.runs) && Number.isFinite(v.seconds) ? v : { runs: 0, seconds: 0 };
      } catch (e) { return { runs: 0, seconds: 0 }; }
    };
    return {
      load: read,
      add(seconds) {
        const v = read();
        const next = { runs: v.runs + 1, seconds: v.seconds + Math.max(0, Math.round(seconds)) };
        try { if (storage) storage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* private mode: keep playing */ }
        return next;
      },
    };
  }

  // "PLAYED 12 TIMES - 1 H 05 MIN"
  function line(v) {
    if (!v || !v.runs) return "";
    const m = Math.floor(v.seconds / 60), h = Math.floor(m / 60);
    const time = h ? h + " H " + String(m % 60).padStart(2, "0") + " MIN" : m + " MIN";
    return "PLAYED " + v.runs + (v.runs === 1 ? " TIME" : " TIMES") + " - " + time;
  }

  // opts: { api, fetch, nav }; send() resolves true when a line went out, never rejects
  function createClient(opts) {
    opts = opts || {};
    const api = String(opts.api === undefined ? (root.BBScoresNet && root.BBScoresNet.API) || "" : opts.api || "").replace(/\/+$/, "");
    const doFetch = opts.fetch || (typeof root.fetch === "function" ? root.fetch.bind(root) : null);
    const enabled = !!api && !!doFetch && !optedOut(opts.nav);
    return {
      enabled,
      // ticket: this run's ticket from the scores Worker; a run without one sends nothing
      async send(event, ticket) {
        if (!enabled || !event || event.seconds < MIN_SECONDS || !ticket) return false;
        try {
          await doFetch(api + "/event", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ...event, ticket }), keepalive: true });
          return true;
        } catch (e) { return false; }
      },
    };
  }

  root.BBPlayStats = { KEY, MIN_SECONDS, DEVICES, optedOut, deviceOf, runEvent, createLocal, line, createClient };
})(globalThis);
