#!/usr/bin/env bash
# Regenerate golden vectors from the PHP oracle, then run the Swift parity suite.
# Usage: tools/oracle/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "▶ Generating golden vectors (real PHP oracle)…"
php tools/oracle/generate_goldens.php

# Goldens/ is gitignored, so the ECO golden must be regenerated here too. This also refreshes the
# committed book artifacts (DemoApp/…/ECO/eco.tsv, web-demo/js/eco-data.js) — they should come out
# byte-identical unless tools/eco/data/ changed.
echo "▶ Building the offline ECO book…"
php tools/eco/build_eco.php

echo "▶ Running Swift parity suite…"
swift run ParityRunner
