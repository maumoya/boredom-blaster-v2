# Architecture

Two parts: a static browser game, and one small Cloudflare Worker for the shared high scores.

```
browser (GitHub Pages)                     Cloudflare Worker + KV
index.html -> version.json -> src/*.js     worker/scores.js
  game loop, render, input, audio  --POST /start-->  signed run ticket (HMAC, nothing stored)
                                   --POST /submit--> checks ticket + plausibility, keeps top 10
                                   --POST /event---> adds to anonymous daily counters
                                   <--GET /top-----  top 10 scores
```

## Browser game (`src/`)

| File | Job |
|---|---|
| `game.js` | Game state and rules: ship, drones, waves, collisions (no DOM) |
| `enemies.js`, `skills.js`, `rewards.js`, `worlds.js` | Enemy types, upgrade families, drops, the five worlds |
| `render.js`, `assets.js`, `ui.js` | Canvas drawing, sprites, menus and HUD |
| `input.js`, `keys.js` | Touch stick, keyboard (remappable) and gamepad |
| `audio.js` | Web Audio music and effects |
| `scores.js` | Shared score rules (initials cleaning, plausibility), also used by the Worker |
| `scoresNet.js`, `playStats.js` | Calls to the Worker |
| `main.js` | Boot and the frame loop |

The rules in `game.js` and `scores.js` have no DOM access, so `node --test` runs them directly.

## Scores Worker (`worker/scores.js`)

`scripts/deploy-scores.sh` (kept in the source repository, not here) uploads `src/scores.js` in front of the Worker,
so the game and the server share one copy of the score rules. Secrets (`STATS_KEY`, the HMAC key) live only in
Cloudflare Worker secrets. KV holds the top 10, rate-limit counters and anonymous daily counters.

## Publishing

This repository is the published build. `tools/publish.sh` copies the game from its source repository,
writes `index.html` and `version.json`, and pushes; GitHub Pages serves it. See [the portfolio page](https://maumoya.github.io/boredom-blaster-v2/portfolio/) for the full write-up.
