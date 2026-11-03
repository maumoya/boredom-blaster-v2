# Changelog

All notable changes to the published build. Versions follow [Semantic Versioning](https://semver.org/):
major = a new game generation, minor = new features, patch = fixes. Gameplay is frozen until v3.

## v2.1.0 — 2026-11-03

First tagged release of the open-source v2 build.

- **Game:** five worlds of 100 waves, seven weapon families up to ULTRA-MAD, five enemy types and two mini-bosses;
  title, results and difficulty screens; touch, keyboard and game controller input.
- **Scores:** arcade high scores on the device plus a global board on a Cloudflare Worker. Every run gets a signed
  ticket; signatures are compared in constant time (#11).
- **Open source:** MIT license, tests in CI, CodeQL, OpenSSF Scorecard and Best Practices (Silver), governance,
  roadmap, architecture and security case (#3–#10).
- **Publishing:** link preview uses the game's pixel title (#12); the publish script keeps the README header (#13).
- **Measured:** 340 / 340 tests pass (`node --test`, 0.39 s); Scorecard 7.2 / 10.
