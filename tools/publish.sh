#!/bin/bash
# Publish ~/BoredomBlaster main to the v2 test link.
# index.html is a fixed shell: on every load it fetches version.json uncached and loads each
# script with ?v=<game commit>, so a normal reload always gets the newest game.
set -euo pipefail
T="$(cd "$(dirname "$0")/.." && pwd)"
G="$HOME/BoredomBlaster"
V="$(git -C "$G" rev-parse --short=7 main)"

# rewards.js and enemies.js load themselves (enemies.js through document.write), so load them first
LIST=$( { echo src/rewards.js; echo src/enemies.js; git -C "$G" show main:index.html | grep -o 'src/[A-Za-z0-9_]*\.js'; } | awk '!seen[$0]++')
JSON=$(echo "$LIST" | sed 's/.*/"&"/' | paste -sd, -)

for f in $(git -C "$G" ls-tree --name-only main src/); do git -C "$G" show "main:$f" > "$T/$f"; done
rm -rf "$T/assets" && git -C "$G" archive main assets | tar -x -C "$T"
printf '{"v":"%s","scripts":[%s]}\n' "$V" "$JSON" > "$T/version.json"

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
  | sed 's#<title>Boredom Blaster</title>#<title>Boredom Blaster v2 (test)</title>\n<meta name="robots" content="noindex">#' \
  | grep -v '<script src="src/' \
  | LOADER="$LOADER" awk '/<\/body>/{print ENVIRON["LOADER"]} {print}' > "$T/index.html"

cd "$T" && git add -A && git commit -qm "Publish game $V" && git push -q
for i in $(seq 1 20); do
  s=$(gh api repos/maumoya/boredom-blaster-v2/pages/builds/latest --jq '.status+" "+.commit[0:7]')
  echo "$s" | grep -q "^built $(git rev-parse --short=7 HEAD)" && break; sleep 10
done
echo "$s  game $V"
