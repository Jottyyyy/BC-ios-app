#!/usr/bin/env bash
# Regenerate golden vectors from the PHP oracle, then run the Swift parity suite.
# Usage: tools/oracle/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "▶ Generating golden vectors (real PHP oracle)…"
php tools/oracle/generate_goldens.php

echo "▶ Running Swift parity suite…"
swift run ParityRunner
