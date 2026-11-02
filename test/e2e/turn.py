"""One chat turn against the local harness: python3 -I test/e2e/turn.py <session|new> "message".

Runs headless Claude with only the Finance Tracker tools and a chat-app system prompt, then prints
the tool calls (with each result's say/next) and the reply. The session id is saved for the next turn.
"""
import json, subprocess, sys, pathlib

HERE = pathlib.Path(__file__).parent
SYSTEM = (
    "You are Claude, an AI assistant made by Anthropic, chatting with the user in the Claude mobile app. "
    "The user has connected a custom connector called Finance Tracker. Be conversational, and format "
    "replies for a phone screen."
)
session, message = sys.argv[1], sys.argv[2]
cmd = ["claude", "-p", message, "--output-format", "stream-json", "--verbose", "--model", "opus",
       "--system-prompt", SYSTEM, "--tools", "", "--strict-mcp-config", "--mcp-config", str(HERE / "mcp.json"),
       "--allowedTools", "mcp__finance__*", "--setting-sources", ""]
if session != "new":
    cmd += ["--resume", session]
out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
sid = None
for line in out.stdout.splitlines():
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        continue
    sid = ev.get("session_id", sid)
    if ev.get("type") == "assistant":
        for block in ev["message"]["content"]:
            if block["type"] == "tool_use":
                print(f"  → {block['name'].split('__')[-1]} {json.dumps(block['input'], ensure_ascii=False)}")
            elif block["type"] == "text" and block["text"].strip():
                print(f"\nCLAUDE: {block['text'].strip()}")
    elif ev.get("type") == "user":
        for block in ev["message"]["content"]:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                content = block["content"]
                text = content[0]["text"] if isinstance(content, list) else content
                try:
                    body = json.loads(text)
                    keep = {k: body[k] for k in ("say", "error", "problems") if k in body}
                    print(f"    ← {json.dumps(keep, ensure_ascii=False)[:600]}")
                except (json.JSONDecodeError, TypeError):
                    print(f"    ← {str(text)[:300]}")
if out.returncode:
    print("STDERR:", out.stderr[-800:])
print(f"\n[session {sid}]")
