#!/usr/bin/env bash
# Inspect an x402 payment quote — no wallet, no account, nothing to install.
set -euo pipefail
URL="${SIRENIC_URL:-https://api.sirenic.eu}"

echo "→ GET $URL/v1/entreprise/552032534 (Danone) without payment"
curl -s -i "$URL/v1/entreprise/552032534" -H "Accept: application/json" | head -30

echo
echo "The PAYMENT-REQUIRED header above is base64 JSON. Decoded:"
curl -s -D- -o /dev/null "$URL/v1/entreprise/552032534" -H "Accept: application/json" \
  | grep -i '^payment-required:' | cut -d' ' -f2 | tr -d '\r' \
  | python3 -c "import base64,json,sys; s=sys.stdin.read().strip(); print(json.dumps(json.loads(base64.b64decode(s+'='*(-len(s)%4))), indent=2))"
