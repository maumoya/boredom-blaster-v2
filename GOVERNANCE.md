# Governance

Boredom Blaster is a single-maintainer project owned by Mauricio Alonso Moya Tapia ([@maumoya](https://github.com/maumoya)).

## Roles

| Role | Who | Responsibilities |
|---|---|---|
| Maintainer | @maumoya | Sets direction, reviews and merges every PR, publishes the build, runs the scores Worker, answers security reports |
| Successor | @mdc-tdm | Takes over the maintainer role if the maintainer becomes unavailable (see Continuity) |
| Contributor | anyone | Opens issues and PRs that follow [CONTRIBUTING.md](CONTRIBUTING.md) |

## How decisions are made

The maintainer decides. Proposals start as an issue so the change is agreed before code is written.
A change lands only through a pull request with green CI (tests and CodeQL) and resolved review conversations.

## Continuity

[@mdc-tdm](https://github.com/mdc-tdm) is the designated successor and holds write access to this repository.
If the maintainer becomes unavailable, the successor can triage issues, merge pull requests and publish
the game within a week, and receives the maintainer's GitHub and Cloudflare access through emergency access.
Without any maintainer, the game keeps running as a static site on GitHub Pages, and anyone can fork it under the MIT License.
