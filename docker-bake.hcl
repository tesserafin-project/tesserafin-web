# Buildx bake definition for the reproducible Tesserafin Web assets image.
#
# The artefact is a static-only build input for the Tesserafin server image
# (tesserafin#115 / [A1.2]); it is never run as a service. Only immutable,
# commit-derived tags are defined here — no `latest`, no `stable`, no release tag.
#
# Reproducible builds require disabling provenance/SBOM attestations, which embed
# build timestamps; docker/build-assets.sh passes the flags that do so.

variable "VERSION" {
  default = "1.0.0"
}

# Full 40-char commit SHA of the tesserafin-web tree being built.
variable "VCS_REF" {
  default = "0000000000000000000000000000000000000000"
}

# Commit time as UNIX seconds — clamps file/layer timestamps for reproducibility.
variable "SOURCE_DATE_EPOCH" {
  default = "0"
}

# Commit time as RFC3339 — the OCI `created` label. Deterministic per commit.
variable "BUILD_DATE" {
  default = "1970-01-01T00:00:00Z"
}

variable "REGISTRY" {
  default = "ghcr.io/tesserafin-project/tesserafin-web-assets"
}

function "short" {
  params = [sha]
  result = substr(sha, 0, 12)
}

# Single platform on purpose: the payload is architecture-neutral static content.
# The server Dockerfile consumes it through a `--platform=linux/amd64` stage pin,
# so its amd64 and arm64 builds copy byte-identical web bytes.
target "web-assets" {
  context    = "."
  dockerfile = "Dockerfile.web-assets"
  target     = "assets"
  platforms  = ["linux/amd64"]

  args = {
    VERSION           = VERSION
    VCS_REF           = VCS_REF
    SOURCE_DATE_EPOCH = SOURCE_DATE_EPOCH
  }

  labels = {
    "org.opencontainers.image.created" = BUILD_DATE
  }

  tags = [
    "${REGISTRY}:${VERSION}-dev.${short(VCS_REF)}",
    "${REGISTRY}:sha-${VCS_REF}",
  ]
}
