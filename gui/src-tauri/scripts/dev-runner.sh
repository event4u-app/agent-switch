#!/bin/sh
# Cargo runner on macOS: sign the dev GUI with the local identity, then run it.
# Only the app binary; test binaries (agent_switch_gui-<hash>) run untouched.
# Signing never stops the launch.
here=$(cd "$(dirname "$0")" && pwd)
case "$(basename "$1")" in
  agent-switch-gui) node "$here/sign-dev-build.mjs" "$1" || true ;;
esac
exec "$@"
