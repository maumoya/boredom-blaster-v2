// Boredom Blaster arcade high scores (this device): top-10 table, initials cleanup, plausibility check
// and localStorage persistence. Plain script like game.js; the tests load it in Node and read globalThis.BBScores.
(function (root) {
  const MAX = 10, KEY = "bb.scores", LEN = 3;
  const MAX_PER_WAVE = 5000; // generous cap on points one wave can pay (40 drones, bosses, splitters, kaboom)
  const MAX_PER_SECOND = 400; // generous cap on points earned per second of play
  const BAD = ["ASS", "FAG", "FUC", "FUK", "CUM", "SEX", "TIT", "KKK", "NIG", "CUN", "DIK", "DCK", "FCK", "SHT", "WTF", "GAY", "JEW", "NZI", "RAP", "POO"];

  // 3 letters A to Z, uppercase; anything else is dropped, short input pads with "A"; bad words become "AAA"
  function cleanInitials(s) {
    let out = String(s === undefined || s === null ? "" : s).toUpperCase().replace(/[^A-Z]/g, "").slice(0, LEN);
    while (out.length < LEN) out += "A";
    return BAD.includes(out) ? "AAA" : out;
  }

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const order = (a, b) => b.score - a.score || (a.date || 0) - (b.date || 0); // score, then earlier date first

  // does this score earn a place? (score must be positive; a full table needs a strictly higher score than the last)
  function qualifies(list, score) {
    if (!(num(score) > 0)) return false;
    list = list || [];
    return list.length < MAX || score > list[MAX - 1].score;
  }

  // returns { list, index }: the new table (top 10) and where the entry landed (-1 when cut)
  function insert(list, entry) {
    const next = [...(list || []), entry].sort(order);
    const index = next.indexOf(entry);
    return { list: next.slice(0, MAX), index: index < MAX ? index : -1 };
  }

  // a run's score is believable for its wave and its length in seconds (inclusive caps)
  function plausible(score, wave, seconds) {
    if (!(num(score) >= 0) || !(num(wave) >= 1) || !(num(seconds) >= 0)) return false;
    return score <= wave * MAX_PER_WAVE && score <= seconds * MAX_PER_SECOND;
  }

  function clean(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && num(s.score) > 0)
      .map((s) => ({
        initials: cleanInitials(s.initials), score: Math.floor(s.score),
        wave: Math.max(1, Math.floor(num(s.wave)) || 1), date: num(s.date) || 0,
      }))
      .sort(order).slice(0, MAX);
  }

  // localStorage-like storage; a missing or broken store never throws
  function createStore(storage) {
    return {
      load() {
        try { return clean(JSON.parse(storage ? storage.getItem(KEY) : null)); } catch (e) { return []; }
      },
      save(list) {
        try { if (storage) storage.setItem(KEY, JSON.stringify(clean(list))); } catch (e) { /* full or blocked */ }
      },
      // adds a record; returns { list, index } (index -1 when it did not make the table)
      add(entry) {
        const e = { initials: cleanInitials(entry.initials), score: Math.floor(entry.score), wave: entry.wave, date: entry.date };
        const r = insert(this.load(), e);
        this.save(r.list);
        return r;
      },
    };
  }

  root.BBScores = { MAX, KEY, LEN, BAD, MAX_PER_WAVE, MAX_PER_SECOND, cleanInitials, qualifies, insert, plausible, createStore };
})(globalThis);
