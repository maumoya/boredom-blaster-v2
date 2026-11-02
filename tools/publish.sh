#!/bin/bash
# Publish ~/BoredomBlaster main to the v2 test link.
# index.html is a fixed shell: on every load it fetches version.json uncached and loads each
# script with ?v=<game commit>, so a normal reload always gets the newest game.
set -euo pipefail
T="$(cd "$(dirname "$0")/.." && pwd)"
G="$HOME/BoredomBlaster"
V="$(git -C "$G" rev-parse --short=7 main)"

# Files that load themselves through document.write (enemies.js, skills.js, ...) never load from a
# script inserted later, so list them first, found from the replace(..., "x.js") calls in src/
SELF=$(git -C "$G" grep -h -o '"[A-Za-z0-9_]*\.js")' main -- src | grep -o '[A-Za-z0-9_]*\.js' | sed 's#^#src/#' || true)
LIST=$( { echo src/rewards.js; echo "$SELF"; git -C "$G" show main:index.html | grep -o 'src/[A-Za-z0-9_]*\.js'; } | awk 'NF && !seen[$0]++')
JSON=$(echo "$LIST" | sed 's/.*/"&"/' | paste -sd, -)

for f in $(git -C "$G" ls-tree --name-only main src/); do git -C "$G" show "main:$f" > "$T/$f"; done
rm -rf "$T/assets" && git -C "$G" archive main assets | tar -x -C "$T"
# the portfolio page about the game, served at <site>/portfolio/
rm -rf "$T/portfolio" && git -C "$G" archive main portfolio | tar -x -C "$T"
# the tests and the scores Worker, so CI can run the tests on the published build
rm -rf "$T/test" "$T/worker" && git -C "$G" archive main test worker package.json | tar -x -C "$T"
printf '{"v":"%s","scripts":[%s]}\n' "$V" "$JSON" > "$T/version.json"

# link preview (iMessage, WhatsApp, Slack); the image and the icons ship with the game in assets/brand/
U="https://maumoya.github.io/boredom-blaster-v2/"
OG="<meta name=\"description\" content=\"Free space shooter. Tap and play: bosses, power-ups and global high scores.\">\\n<meta property=\"og:type\" content=\"website\">\\n<meta property=\"og:url\" content=\"$U\">\\n<meta property=\"og:title\" content=\"Boredom Blaster\">\\n<meta property=\"og:description\" content=\"Free space shooter. Tap and play: bosses, power-ups and global high scores.\">\\n<meta property=\"og:image\" content=\"${U}assets/brand/preview.jpg?v=$V\">\\n<meta property=\"og:image:width\" content=\"1200\">\\n<meta property=\"og:image:height\" content=\"630\">\\n<meta name=\"twitter:card\" content=\"summary_large_image\">"

LOADER='<script>
(function () {
  var fallback = ['"$JSON"'];
  function load(list, v, i) {
    if (i >= list.length) return;
    var s = document.createElement("script");
    s.src = list[i] + "?v=" + v;
    s.async = false;
    s.onload = function () { load(list, v, i + 1); };
    s.onerror = function () { console.error("Boredom Blaster: " + list[i] + " failed to load"); };
    document.body.appendChild(s);
  }
  fetch("version.json", { cache: "no-store" }).then(function (r) { return r.json(); })
    .then(function (d) { load(d.scripts, d.v, 0); })
    .catch(function () { load(fallback, Date.now(), 0); });
})();
</script>'
git -C "$G" show main:index.html \
  | sed "s#<title>Boredom Blaster</title>#<title>Boredom Blaster</title>\\n<meta name=\"robots\" content=\"noindex\">\\n$OG#" \
  | grep -v '<script src="src/' \
  | LOADER="$LOADER" awk '/<\/body>/{print ENVIRON["LOADER"]} {print}' > "$T/index.html"

cd "$T" && git add -A && git commit -qm "Publish game $V" && git push -q
for i in $(seq 1 20); do
  s=$(gh api repos/maumoya/boredom-blaster-v2/pages/builds/latest --jq '.status+" "+.commit[0:7]')
  echo "$s" | grep -q "^built $(git rev-parse --short=7 HEAD)" && break; sleep 10
done
echo "$s  game $V"
