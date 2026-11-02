# Governance

Boredom Blaster is a single-maintainer project owned by Mauricio Alonso Moya Tapia ([@maumoya](https://github.com/maumoya)).

## Roles

| Role | Who | Responsibilities |
|---|---|---|
| Maintainer | @maumoya | Sets direction, reviews and merges every PR, publishes the build, runs the scores Worker, answers security reports |
| Contributor | anyone | Opens issues and PRs that follow [CONTRIBUTING.md](CONTRIBUTING.md) |

## How decisions are made

The maintainer decides. Proposals start as an issue so the change is agreed before code is written.
A change lands only through a pull request with green CI (tests and CodeQL) and resolved review conversations.

## Continuity

Today only the maintainer holds admin access to this repository and to the Cloudflare account that runs the scores Worker.
There is no second person with access yet. If the maintainer becomes unavailable, the game keeps running as a static site
on GitHub Pages, and anyone can fork it under the MIT License; the shared score table would stop being maintained.
