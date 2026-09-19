#!/usr/bin/env bash
set -euo pipefail

CHANNEL="${1:-}"
ENVIRONMENT="${2:-}"
PROFILE="${3:-}"
MESSAGE="${4:-}"

if [[ -z "$CHANNEL" || -z "$ENVIRONMENT" || -z "$PROFILE" || -z "$MESSAGE" ]]; then
  echo "Usage: publish-eas-update.sh <channel> <environment> <android-build-profile> <message>" >&2
  exit 2
fi

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required. Store it in GitHub Actions secrets, not in the repository." >&2
  exit 1
fi

echo "Channel: $CHANNEL"
echo "EAS environment: $ENVIRONMENT"
echo "Android build profile: $PROFILE"
echo "Message: $MESSAGE"

echo "Generating Android fingerprint for profile ${PROFILE}..."
FINGERPRINT_JSON="$(eas fingerprint:generate --platform android --build-profile "$PROFILE" --json --non-interactive)"
HASH="$(
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8").trim();
    const parsed = JSON.parse(raw);
    const hash = parsed.hash || parsed.fingerprintHash || parsed.fingerprint?.hash;
    if (!hash) {
      console.error("Could not read fingerprint hash from eas fingerprint:generate JSON.");
      process.exit(1);
    }
    process.stdout.write(String(hash));
  ' <<<"$FINGERPRINT_JSON"
)"

echo "Android fingerprint: $HASH"

echo "Looking for a finished Android build with this fingerprint..."
BUILDS_JSON="$(eas build:list --platform android --fingerprint-hash "$HASH" --status finished --limit 20 --json --non-interactive)"
MATCH_COUNT="$(
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(0, "utf8").trim() || "[]";
    const parsed = JSON.parse(raw);
    const builds = Array.isArray(parsed) ? parsed : parsed.builds || parsed.data || [];
    process.stdout.write(String(builds.length));
  ' <<<"$BUILDS_JSON"
)"

if [[ "$MATCH_COUNT" -eq 0 ]]; then
  echo "::error::No finished Android build matches fingerprint ${HASH}."
  echo "This JavaScript change requires a new native runtime/build."
  echo "Installed APKs on channel ${CHANNEL} will not receive it."
  echo "Build and install a replacement binary with the same package id and signing identity from a clean git tree:"
  echo "  npx eas-cli@latest build --profile ${PROFILE} --platform android"
  echo "Then republish this commit after that APK finishes."
  echo "EAS Build uploads modified tracked files. Uncommitted icon, splash, or app.json native changes in that upload will not match this commit's fingerprint."
  echo "Compare sources with: eas fingerprint:compare ${HASH} --build-id <finished-android-build-id> --environment ${ENVIRONMENT}"
  exit 1
fi

echo "Found ${MATCH_COUNT} finished Android build(s) for this fingerprint. Publishing a compatible update..."
eas update \
  --channel "$CHANNEL" \
  --environment "$ENVIRONMENT" \
  --platform android \
  --message "$MESSAGE" \
  --non-interactive

echo "Published to channel ${CHANNEL} with EAS environment ${ENVIRONMENT}."
echo "Installed APKs with fingerprint ${HASH} can download this update."
