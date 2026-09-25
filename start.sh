#!/bin/bash
# start.sh — USB AI Agent entry (POSIX). Delegates to tools/bootstrap.sh.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/tools/bootstrap.sh" "$@"