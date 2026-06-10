#!/usr/bin/env bash
# v0.9.18 Gate 5 — build a PREVIEW (release-candidate) image for browser
# verification BEFORE the real tag exists. Tags the image `:<version>-rcN`
# (e.g. cairn:0.9.18-rc1) so the user can pull, redeploy, and sweep every
# carry-forward item live. The final `:0.9.18` image is only built by the tag
# workflow AFTER the user replies VERIFIED.
#
# Usage:
#   scripts/build-preview-image.sh <version> <rcN> [--push]
#   scripts/build-preview-image.sh 0.9.18 rc1            # local build
#   scripts/build-preview-image.sh 0.9.18 rc1 --push     # build + push to GHCR
#
# Builds BOTH images (cairn + cairn-collab) for the host arch. For a
# multi-arch RC, push from CI instead; this script targets a fast local RC for
# the homelab (single arch, matches the deploy host).
set -euo pipefail

VERSION="${1:?usage: build-preview-image.sh <version> <rcN> [--push]}"
RC="${2:?usage: build-preview-image.sh <version> <rcN> [--push]}"
PUSH="${3:-}"

REGISTRY="ghcr.io/jonathanmcohen"
TAG="${VERSION}-${RC}"

case "$RC" in
  rc[0-9]*) ;;
  *) echo "error: rc segment must look like 'rc1', 'rc2', … (got '$RC')" >&2; exit 1 ;;
esac

echo "==> Building preview images @ ${TAG}"

build_one() {
  local image="$1" dockerfile="$2"
  local ref="${REGISTRY}/${image}:${TAG}"
  echo "--> ${ref} (from ${dockerfile})"
  docker build -f "$dockerfile" -t "$ref" .
  if [ "$PUSH" = "--push" ]; then
    echo "--> push ${ref}"
    docker push "$ref"
  fi
}

build_one cairn Dockerfile
build_one cairn-collab Dockerfile.collab

echo "==> Done. Preview images tagged ${TAG}."
if [ "$PUSH" = "--push" ]; then
  echo "    Pushed:"
  echo "      ${REGISTRY}/cairn:${TAG}"
  echo "      ${REGISTRY}/cairn-collab:${TAG}"
  echo "    Redeploy: docker compose pull cairn cairn-collab && docker compose up -d"
else
  echo "    Local only. Re-run with --push to publish to GHCR."
fi
