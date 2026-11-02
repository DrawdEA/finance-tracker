#!/bin/sh
# Call one tool on the local harness: test/e2e/call.sh finance_status '{}'
curl -s localhost:8790/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$2}}" \
  | sed -n 's/^data: //p' | python3 -I -c 'import json,sys; r=json.load(sys.stdin)["result"]; b=json.loads(r["content"][0]["text"]); print(b.get("say") or b.get("error") or b.get("summary")); print("  next:", (b.get("next") or "")[:160])'
