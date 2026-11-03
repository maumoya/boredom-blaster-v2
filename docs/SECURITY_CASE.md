# Security requirements and assurance case

## What the software must and must not do

| Requirement | How it is met |
|---|---|
| Keep no personal data | No accounts, cookies or IDs. A score keeps only three initials, points, wave and date. Daily counters keep totals and country only. |
| Refuse forged scores | Every run gets a ticket signed with HMAC-SHA256 (Web Crypto) and the server's clock. A score needs a valid, unused ticket, and its wave, time and points must fit the real time that passed. |
| Refuse abuse | Bodies over 200 bytes are refused; each client is rate limited (5 submits, 30 run lines per 10 minutes); CORS allows only the game's origin. |
| Validate every input | The Worker checks types, integer ranges and allowed values for every field before use; initials are cleaned to three A-Z letters. |
| Never run untrusted HTML | The game builds no HTML from user or server data; the one `document.write` writes the page's own script URL, HTML-escaped. |
| Keep secrets out of the repo | The HMAC key and stats key exist only as Cloudflare Worker secrets; the deploy script with the API token is not published. |

## Assurance case

- **Threat model.** Attackers are players who want a fake top score, or anyone sending crafted requests to the Worker.
  The browser is untrusted: all checks that matter run in the Worker.
- **Trust boundaries.** Browser to Worker (HTTPS, JSON, size-limited); Worker to KV (Cloudflare internal).
- **Secure design principles applied.** Least privilege (the Worker binds only its KV namespace), fail closed
  (any parse or check failure refuses the request), economy of mechanism (one small file, no dependencies),
  complete mediation (every write needs a fresh, verified ticket).
- **Common weaknesses countered.** Injection and XSS (no HTML from data, escaped script URL), forgery and replay
  (signed, single-use, time-bound tickets), resource exhaustion (body size and rate limits), secret leakage (secrets only in the runtime).
- **Evidence.** 340 automated tests (`node --test`, about 95% line coverage) include the Worker's checks; CodeQL
  security-and-quality runs on every PR; OpenSSF Scorecard runs weekly.

## Secret comparisons

The `/stats` bearer key and run-ticket signatures are compared through SHA-256 digests without stopping at
the first difference (`sameText` in `worker/scores.js`), so response time does not reveal how much of a secret matched.
