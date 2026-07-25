#!/usr/bin/env bash
# Clean, deterministic build of the Tesserafin Web assets image
# (tesserafin#115 / [A1.2]).
#
# Derives every build-affecting value from git + package.json so the same commit
# always produces the same inputs, then drives docker-bake.hcl.
#
# Usage:
#   docker/build-assets.sh [--output MODE] [--builder NAME]
#
#   --output load          load the image into the local docker (default)
#   --output oci:PATH      write a reproducible OCI layout tarball to PATH
#   --output push          push the immutable tags to $REGISTRY
#
# Reproducibility: provenance and SBOM attestations are disabled (they embed
# wall-clock timestamps); layer/file mtimes are clamped to the commit time.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

OUTPUT="load"
BUILDER="${BUILDX_BUILDER:-tf-builder}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)  OUTPUT="$2"; shift 2 ;;
    --builder) BUILDER="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- Derive deterministic inputs -------------------------------------------
VERSION="$(node -p "require('./package.json').version")"
[[ -n "${VERSION}" ]] || { echo "could not read version from package.json" >&2; exit 1; }
VCS_REF="$(git rev-parse HEAD)"
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct HEAD)"
BUILD_DATE="$(date -u -d "@${SOURCE_DATE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)"
REGISTRY="${REGISTRY:-ghcr.io/tesserafin-project/tesserafin-web-assets}"
export VERSION VCS_REF SOURCE_DATE_EPOCH BUILD_DATE REGISTRY

if [[ -n "$(git status --porcelain)" ]]; then
  echo "WARNING: working tree is dirty — build is not from a clean commit." >&2
fi

echo "== Tesserafin Web assets image build =="
echo "  version           : ${VERSION}"
echo "  commit            : ${VCS_REF}"
echo "  source_date_epoch : ${SOURCE_DATE_EPOCH} (${BUILD_DATE})"
echo "  output            : ${OUTPUT}"
echo "  builder           : ${BUILDER}"
echo "  registry          : ${REGISTRY}"

COMMON=( bake --builder "${BUILDER}" --no-cache
         --set "*.attest=type=provenance,disabled=true"
         --set "*.attest=type=sbom,disabled=true" )

case "${OUTPUT}" in
  load)
    exec docker buildx "${COMMON[@]}" --load web-assets
    ;;
  oci:*)
    DEST="${OUTPUT#oci:}"
    DESTDIR="$(cd "$(dirname "${DEST}")" && pwd)"
    exec docker buildx "${COMMON[@]}" \
        --allow "fs.write=${DESTDIR}" \
        --set "web-assets.output=type=oci,dest=${DEST},rewrite-timestamp=true" \
        web-assets
    ;;
  push)
    exec docker buildx "${COMMON[@]}" --push web-assets
    ;;
  *)
    echo "unknown --output: ${OUTPUT}" >&2; exit 2 ;;
esac
