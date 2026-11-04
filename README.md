<p align="center">
  <a href="https://maumoya.github.io/boredom-blaster-v2/"><img src="assets/brand/header/header.png" alt="Boredom Blaster: a free neon space shooter you play in the browser, with world bosses, power-ups and global scores" width="100%"></a>
</p>

<p align="center">
  <a href="https://maumoya.github.io/boredom-blaster-v2/"><img src="https://img.shields.io/badge/%E2%96%B6%20PLAY%20NOW-in%20your%20browser-ff8a2a?style=for-the-badge" alt="Play now in your browser"></a>
  <a href="https://maumoya.github.io/boredom-blaster-v2/portfolio/"><img src="https://img.shields.io/badge/HOW%20IT'S%20BUILT-portfolio-3ff0ff?style=for-the-badge" alt="How it's built: portfolio page"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/plain%20JavaScript-no%20engine-f7df1e?logo=javascript&logoColor=black" alt="Plain JavaScript, no game engine">
  <img src="https://img.shields.io/badge/HTML-canvas-e34f26?logo=html5&logoColor=white" alt="HTML canvas">
  <img src="https://img.shields.io/badge/plays%20on-phone%20%C2%B7%20desktop%20%C2%B7%20controller-7c5cfc" alt="Plays on phone, desktop and game controllers">
  <img src="https://img.shields.io/badge/tests-340%20automated-2da44e" alt="340 automated tests">
  <img src="https://img.shields.io/badge/hosting-%240-2da44e" alt="Hosting cost: $0">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/privacy-no%20accounts%20%C2%B7%20no%20cookies-7c5cfc" alt="Privacy: no accounts, no cookies">
  <img src="https://img.shields.io/badge/scores-anti--cheat%20signed%20tickets-f38020?logo=cloudflare&logoColor=white" alt="Global scores with anti-cheat signed tickets on Cloudflare Workers">
  <br>
  <a href="https://github.com/maumoya/boredom-blaster-v2/actions/workflows/test.yml"><img src="https://github.com/maumoya/boredom-blaster-v2/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/maumoya/boredom-blaster-v2/actions/workflows/codeql.yml"><img src="https://github.com/maumoya/boredom-blaster-v2/actions/workflows/codeql.yml/badge.svg" alt="CodeQL"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/maumoya/boredom-blaster-v2"><img src="https://api.scorecard.dev/projects/github.com/maumoya/boredom-blaster-v2/badge" alt="OpenSSF Scorecard"></a>
  <a href="https://www.bestpractices.dev/projects/16185"><img src="https://www.bestpractices.dev/projects/16185/badge" alt="OpenSSF Best Practices"></a>
  <a href="https://github.com/maumoya/boredom-blaster-v2/releases/latest"><img src="https://img.shields.io/github/v/release/maumoya/boredom-blaster-v2" alt="Latest release"></a>
</p>

<p align="center">
  <img src="docs/demo.gif" width="300" alt="Boredom Blaster v2 gameplay: a fully upgraded ship moving in all directions, then a new record and the top-10 table.">
</p>

# Boredom Blaster

**A fast, neon space shooter that runs in any browser.** Steer, power up, beat the bosses and climb a
global high-score table that cannot be faked. Free, no install, no sign-up.

<p align="center">
  <img src="portfolio/img/play.jpg" alt="Wave 24: the ship fires seven streams of cyan bolts at a row of alien saucers while a mini-boss circles above" width="32%">
  <img src="portfolio/img/laser.jpg" alt="Wave 46: a two-row saucer formation and drifting asteroids above the ship" width="32%">
  <img src="portfolio/img/frost.jpg" alt="Wave 71: a mini-boss with a glowing core leads a row of saucers while the ship fires four-wide volleys" width="32%">
</p>

| 5 worlds | 7 weapon families | 340 tests | $0 |
|:---:|:---:|:---:|:---:|
| 100 waves each, then it loops harder | up to ULTRA-MAD | game rules, input, score server, anti-cheat | to host and run |

## The game

- **Pick your build.** Seven upgrade families (more shots, faster shots, lasers, orbiting moons, a magnet and more), each climbing to MASTERED and ULTRA-MAD.
- **Bosses and worlds.** Five enemy types and two mini-bosses on curved entry paths, across five worlds with their own sky, colors and music.
- **Play anywhere.** Thumb stick and buttons on the phone, a left-hand mode, remappable keyboard keys, and game controller support.

## How it is built

Written from scratch in plain JavaScript and the HTML canvas, with no game engine or framework.
Static hosting on GitHub Pages, plus one small Cloudflare Worker for the shared scores.

- **A score table that refuses fakes.** Every run gets a signed ticket from the server (HMAC with the server's clock). A score is accepted only with a valid, unused ticket, and only if its waves, play time and points fit the real time that passed. Practice runs never post.
- **Privacy first.** No accounts, no cookies, no IDs. The only stats are anonymous counts of finished runs. Only three initials are kept with a score.
- **Always the newest version.** `index.html` reads `version.json` uncached and loads every script with the game's commit as its version, so a normal reload gets the latest build.

Stack: JavaScript · HTML Canvas · Web Audio · Gamepad API · Cloudflare Workers + KV · GitHub Pages · `node:test`.
The full write-up, with screens and the score flow end to end, is on the [portfolio page](https://maumoya.github.io/boredom-blaster-v2/portfolio/).

## This repository

This is the published build. `tools/publish.sh` copies the game from its source repository,
regenerates `index.html` and `version.json`, and pushes; GitHub Pages serves the result.
It also carries the tests (`test/`, run with `node --test`) and the scores Worker (`worker/`).

## Results

Measured on 2026-11-03 against `main` at `f15218c` (release v2.1.0), Node 24, macOS. Repeat it with the command below.

<img src="docs/tests-card.svg" align="right" width="220" alt="340 automated tests pass; OpenSSF Scorecard 7.2 of 10; Best Practices Silver">

| Check | Result |
|---|---|
| Automated tests (`node --test`) | **<!--fact:tests-->340<!--/fact--> / <!--fact:tests-->340<!--/fact--> pass**, 0 fail, 0.39 s |
| Live site serves this build | site `version.json` = game commit `abaab50`, same as `main` |
| OpenSSF Scorecard | **<!--fact:scorecard-->7.2<!--/fact--> / 10** (scan of 2026-11-03) |
| OpenSSF Best Practices | **<!--fact:best_practices-->Silver<!--/fact-->** |

```bash
git clone https://github.com/maumoya/boredom-blaster-v2 && cd boredom-blaster-v2 && node --test
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), [ROADMAP.md](ROADMAP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); the security requirements are in [docs/SECURITY_CASE.md](docs/SECURITY_CASE.md).

## About the author

Designed and developed by **Mauricio Alonso Moya Tapia** ([@maumoya](https://github.com/maumoya)). Released under the [MIT License](LICENSE).
More of my work on [GitHub](https://github.com/maumoya); say hi on [LinkedIn](https://www.linkedin.com/in/mba-mmoyat/).

## Credits

Ship and enemy sprites: "Space Shooter Redux" by Kenney ([kenney.nl](https://www.kenney.nl)), CC0.
