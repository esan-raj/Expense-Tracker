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

COMPATIBILITY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/eas-build-compatibility.js"
TARGET="$(node "$COMPATIBILITY" target --channel "$CHANNEL")"
TARGET_ENVIRONMENT="$(sed -n 's/^environment=//p' <<<"$TARGET")"
ALLOWED_PROFILES="$(sed -n 's/^allowed_profiles=//p' <<<"$TARGET")"
if [[ "$ENVIRONMENT" != "$TARGET_ENVIRONMENT" ]]; then
  echo "::error::Channel ${CHANNEL} publishes with environment ${TARGET_ENVIRONMENT}, not ${ENVIRONMENT}." >&2
  exit 2
fi
if [[ ",${ALLOWED_PROFILES}," != *",${PROFILE},"* ]]; then
  echo "::error::Build profile ${PROFILE} is not allowed for channel ${CHANNEL} (allowed: ${ALLOWED_PROFILES})." >&2
  exit 2
fi

echo "Channel: $CHANNEL"
echo "EAS environment: $ENVIRONMENT"
echo "Android build profile: $PROFILE"
echo "Android build profiles allowed to receive channel ${CHANNEL}: ${ALLOWED_PROFILES}"
echo "Message: $MESSAGE"

node "$COMPATIBILITY" profiles --channel "$CHANNEL"

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

BUILD_LIMIT=50
BUILDS_JSON="$(mktemp)"
trap 'rm -f "$BUILDS_JSON"' EXIT
echo "Looking for a finished Android build on channel ${CHANNEL} with this fingerprint..."
eas build:list --platform android --fingerprint-hash "$HASH" --status finished --limit "$BUILD_LIMIT" --json --non-interactive > "$BUILDS_JSON"

set +e
node "$COMPATIBILITY" check --channel "$CHANNEL" --fingerprint "$HASH" --builds-file "$BUILDS_JSON" --limit "$BUILD_LIMIT"
CHECK_STATUS=$?
set -e
if [[ "$CHECK_STATUS" -ne 0 && "$CHECK_STATUS" -ne 1 ]]; then
  echo "::error::The build compatibility check could not run (exit code ${CHECK_STATUS}). Nothing was published." >&2
  exit "$CHECK_STATUS"
fi
if [[ "$CHECK_STATUS" -eq 1 ]]; then
  echo "A build from another channel or profile never authorizes an update on channel ${CHANNEL}."
  echo "Installed binaries on channel ${CHANNEL} would not receive this update, so it was not published."
  echo "Build and install a replacement binary (profile ${ALLOWED_PROFILES//,/ or }) with the same package id and signing identity from a clean git tree:"
  echo "  npx eas-cli@latest build --profile ${PROFILE} --platform android"
  echo "Then republish this commit after that build finishes."
  echo "EAS Build uploads modified tracked files. Uncommitted icon, splash, or app.json native changes in that upload will not match this commit's fingerprint."
  echo "Compare sources with: eas fingerprint:compare ${HASH} --build-id <finished-android-build-id> --environment ${ENVIRONMENT}"
  exit 1
fi

echo "Publishing a compatible update..."
eas update \
  --channel "$CHANNEL" \
  --environment "$ENVIRONMENT" \
  --platform android \
  --message "$MESSAGE" \
  --non-interactive

echo "Published to channel ${CHANNEL} with EAS environment ${ENVIRONMENT}."
echo "Installed ${ALLOWED_PROFILES//,/ or } binaries on channel ${CHANNEL} with fingerprint ${HASH} can download this update."
