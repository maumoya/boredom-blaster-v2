# Contributing

1. Open an issue first for anything bigger than a typo, so we agree on the change.
2. Branch, change, and run the tests locally (Node 20 or newer, no install step):
   ```bash
   node --test
   ```
3. New behavior needs a test in `test/`. Bug fixes need a test that failed before the fix.
4. Open a PR. CI (tests and CodeQL) must be green. A maintainer reviews and merges.

## Coding standards

- Plain JavaScript (ES2020+), no dependencies, no build step. English only.
- Two-space indent, double quotes, semicolons, `const`/`let` (never `var`); match the surrounding code.
- Game rules stay free of DOM access so tests can run them in Node.
- CodeQL (security-and-quality) runs on every PR and must report no new warnings.

By contributing you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).
