#!/usr/bin/env bash
# Content audit of the Tesserafin Web assets image (tesserafin#115 / [A1.2]).
#
# The image is `FROM scratch`, so it has no shell and cannot be inspected from
# inside. This script exports its filesystem and asserts, against the exported
# tree, everything the artefact promises:
#
#   * /web/index.html exists and is a real HTML document
#   * every script/style/manifest referenced by index.html is present in /web
#   * the production bundle budget is still satisfied
#   * no sourcemap, no source tree, no node_modules, no npm cache, no build tool
#   * no runtime Node.js and no executable entrypoint
#   * licence + attribution + a deterministic revision manifest are present
#   * no jellyfin.org runtime dependency is introduced by the bundle
#   * no credential-shaped material anywhere in the image
#
# Usage: docker/verify-assets-image.sh <image-ref>
set -euo pipefail

IMAGE="${1:?usage: docker/verify-assets-image.sh <image-ref>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WORK="$(mktemp -d)"
cleanup() { rm -rf "${WORK}"; }
trap cleanup EXIT

fail() { echo "ASSETS-AUDIT: FAIL — $*" >&2; exit 1; }
ok()   { echo "  ok  — $*"; }

echo "== assets image content audit: ${IMAGE} =="

# `docker save` + layer extraction, NOT `docker export`. Export runs the image
# through a container, so Docker's own injected runtime files (/etc/hosts,
# /etc/hostname, /etc/resolv.conf, /.dockerenv) would appear in the tree and be
# indistinguishable from real image content. `docker save` yields exactly the
# layers the registry stores. Both the legacy (manifest.json) and the OCI
# (index.json + blobs) archive layouts are handled, because which one `docker
# save` emits depends on whether the containerd image store is enabled.
FS="${WORK}/fs"
mkdir -p "${FS}" "${WORK}/img"
docker save "${IMAGE}" -o "${WORK}/img.tar"
tar -xf "${WORK}/img.tar" -C "${WORK}/img"

mapfile -t LAYERS < <(python3 - "${WORK}/img" <<'PY'
import json, os, sys
root = sys.argv[1]
legacy = os.path.join(root, "manifest.json")
if os.path.exists(legacy):
    entries = json.load(open(legacy))
    # A single-image archive; a multi-image save is not something this audits.
    if len(entries) != 1:
        sys.exit(f"expected exactly one image in the archive, found {len(entries)}")
    for layer in entries[0]["Layers"]:
        print(layer)
    sys.exit(0)

idx = json.load(open(os.path.join(root, "index.json")))
def blob(digest):
    algo, hexd = digest.split(":")
    return os.path.join(root, "blobs", algo, hexd)
desc = idx["manifests"][0]
man = json.load(open(blob(desc["digest"])))
if "manifests" in man:                      # an index-of-indexes: take the first image
    man = json.load(open(blob(man["manifests"][0]["digest"])))
for layer in man["layers"]:
    algo, hexd = layer["digest"].split(":")
    print(os.path.join("blobs", algo, hexd))
PY
)
[[ "${#LAYERS[@]}" -gt 0 ]] || fail "could not enumerate image layers"
for l in "${LAYERS[@]}"; do
  tar -xf "${WORK}/img/${l}" -C "${FS}"
done
ok "extracted ${#LAYERS[@]} image layer(s) from the saved image"

# --- 1. the bundle is present and is a real web document --------------------
[[ -s "${FS}/web/index.html" ]] || fail "/web/index.html is missing or empty"
grep -qi '<!doctype html' "${FS}/web/index.html" || fail "/web/index.html is not an HTML document"
grep -qi 'Tesserafin' "${FS}/web/index.html" || fail "/web/index.html does not identify Tesserafin"
if grep -qi 'swagger\|redoc\|api-docs' "${FS}/web/index.html"; then
  fail "/web/index.html looks like API documentation"
fi
ok "/web/index.html is a Tesserafin Web production document"

# --- 2. every asset index.html references actually exists -------------------
# Resolved with percent-decoding: webpack emits chunk names such as
# `node_modules.@mui.material.bundle.js`, which appear URL-encoded in the markup.
python3 - "${FS}/web" <<'PY' || exit 1
import os, re, sys
from urllib.parse import unquote, urlparse
root = sys.argv[1]
html = open(os.path.join(root, "index.html"), encoding="utf-8").read()
refs = re.findall(r'(?:src|href)="([^"]+)"', html)
checked = missing = 0
for ref in refs:
    if ref.startswith(("http://", "https://", "//", "data:", "#", "mailto:")):
        continue
    path = unquote(urlparse(ref).path).lstrip("/")
    if not path:
        continue
    checked += 1
    if not os.path.exists(os.path.join(root, path)):
        print(f"    missing referenced asset: {ref}", file=sys.stderr)
        missing += 1
if missing:
    print(f"ASSETS-AUDIT: FAIL — {missing} asset(s) referenced by index.html are absent", file=sys.stderr)
    sys.exit(1)
print(f"  ok  — all {checked} local asset(s) referenced by index.html are present")
PY

# --- 3. the first-run wizard is actually shipped ----------------------------
grep -rql 'Startup/Configuration' "${FS}/web" >/dev/null \
  || fail "no bundled chunk references the first-run wizard endpoints (Startup/Configuration)"
ok "first-run wizard code is present in the bundle"

# --- 4. bundle budget ------------------------------------------------------
BUDGET_ASSET="$(python3 -c "import json;print(json.load(open('${REPO_ROOT}/webpack.performance-budget.json'))['mainBundleAsset'])")"
BUDGET_BYTES="$(python3 -c "import json;print(json.load(open('${REPO_ROOT}/webpack.performance-budget.json'))['mainBundleBudgetBytes'])")"
[[ -f "${FS}/web/${BUDGET_ASSET}" ]] || fail "budgeted asset ${BUDGET_ASSET} is absent"
SIZE="$(stat -c %s "${FS}/web/${BUDGET_ASSET}")"
[[ "${SIZE}" -le "${BUDGET_BYTES}" ]] \
  || fail "${BUDGET_ASSET} is ${SIZE} B, over the ${BUDGET_BYTES} B budget"
ok "${BUDGET_ASSET} = ${SIZE} B (budget ${BUDGET_BYTES} B)"

# --- 5. nothing that must not ship -----------------------------------------
! find "${FS}" -name '*.map' | grep -q . || fail "sourcemaps leaked into the image"
for forbidden in node_modules src .npm .cache package.json package-lock.json webpack.common.js usr bin lib etc; do
  if [[ -e "${FS}/${forbidden}" ]]; then
    fail "forbidden path present in the image: /${forbidden}"
  fi
done
! find "${FS}" -type f -name 'node' | grep -q . || fail "a Node.js runtime leaked into the image"
ok "no source tree, node_modules, npm cache, build tool or Node.js runtime"

# --- 6. only the promised top-level layout ----------------------------------
TOP="$(find "${FS}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort | tr '\n' ' ')"
[[ "${TOP}" == "licenses metadata web " ]] || fail "unexpected top-level layout: '${TOP}'"
ok "top-level layout is exactly: licenses metadata web"

# --- 7. licence, attribution, deterministic revision manifest ---------------
[[ -s "${FS}/licenses/LICENSE" ]] || fail "/licenses/LICENSE is missing"
[[ -s "${FS}/licenses/CONTRIBUTORS.md" ]] || fail "/licenses/CONTRIBUTORS.md is missing"
[[ -s "${FS}/metadata/web-revision.json" ]] || fail "/metadata/web-revision.json is missing"
python3 - "${FS}/metadata/web-revision.json" <<'PY' || exit 1
import json,re,sys
m=json.load(open(sys.argv[1]))
for k in ("repository","revision","version","license","sourceDateEpoch"):
    assert k in m and m[k], f"web-revision.json lacks {k}"
assert re.fullmatch(r"[0-9a-f]{40}", m["revision"]), f"revision is not a full commit sha: {m['revision']}"
print(f"  ok  — /metadata/web-revision.json: {m['version']} @ {m['revision']}")
PY

# --- 8. no RUNTIME jellyfin.org dependency ----------------------------------
# The distinction matters and is not cosmetic. Upstream documentation hyperlinks
# to jellyfin.org (setup-wizard guide, libraries guide) are inert `<a href>`
# targets a user may click; they load nothing and the app works offline without
# them. A *runtime* dependency would be a script, stylesheet, font, image or
# fetch/XHR/import that the page must retrieve from jellyfin.org to function.
# Only the latter is a defect here, so only the latter fails.
if grep -qi 'jellyfin\.org' "${FS}/web/index.html"; then
  fail "index.html references jellyfin.org"
fi
if grep -rIohE '(<(script|link|img)[^>]+(src|href)="https?://[^"]*jellyfin\.org[^"]*")' "${FS}/web" 2>/dev/null | grep -q .; then
  fail "a resource tag loads from jellyfin.org at runtime"
fi
if grep -rIohE '(fetch|import|XMLHttpRequest[^;]{0,80}open)\([^)]{0,120}jellyfin\.org' "${FS}/web" 2>/dev/null | grep -q .; then
  fail "the bundle fetches from jellyfin.org at runtime"
fi
DOCLINKS="$(grep -rIoh 'https://jellyfin\.org[^"'"'"' ]*' "${FS}/web" 2>/dev/null | sort -u | wc -l)"
ok "no runtime jellyfin.org dependency (${DOCLINKS} inert documentation hyperlink(s) carried over from upstream)"

# --- 9. no executable entrypoint (this is a build input, not a service) -----
ENTRY="$(docker image inspect --format '{{json .Config.Entrypoint}}{{json .Config.Cmd}}' "${IMAGE}")"
[[ "${ENTRY}" == "nullnull" ]] || fail "the assets image declares an entrypoint/cmd: ${ENTRY}"
ok "no entrypoint and no cmd — build input only"

# --- 10. no credentials ----------------------------------------------------
if grep -rIlE 'ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}' "${FS}" 2>/dev/null | grep -q .; then
  fail "credential-shaped material found in the image"
fi
[[ ! -e "${FS}/root/.docker" && ! -e "${FS}/.docker" && ! -e "${FS}/.npmrc" ]] || fail "credential store leaked into the image"
ok "no credential-shaped material"

echo "ASSETS-AUDIT: all gates passed"
