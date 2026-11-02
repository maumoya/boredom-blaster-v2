# Contributing

1. Open an issue first for anything bigger than a typo, so we agree on the change.
2. Branch, change, and run the tests locally (Node 20 or newer, no install step):
   ```bash
   node --test
   ```
3. New behavior needs a test in `test/`. Bug fixes need a test that failed before the fix.
4. Open a PR. CI (tests and CodeQL) must be green. A maintainer reviews and merges.

Plain JavaScript, no dependencies, English only.
