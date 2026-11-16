#!/usr/bin/env bash
# Aaron runs this himself on the Blink. The key is typed hidden, saved where only his user can read it,
# and is never shown, logged or sent anywhere except to Anthropic when Alice answers.
set -u
F="$HOME/.config/alice/claude.env"
echo "Give Alice her Claude key"
echo "-------------------------"
echo "Paste the key from console.anthropic.com (it starts with sk-ant-) and press Enter."
echo "Nothing shows while you paste. That is normal."
echo
read -r -s -p "Key: " K
echo
K="$(printf '%s' "$K" | tr -d '[:space:]')"
case "$K" in
  sk-ant-*) ;;
  *) echo "That does not look like an Anthropic key (it should start with sk-ant-). Nothing was saved."; exit 1 ;;
esac
mkdir -p "$(dirname "$F")"
chmod 700 "$(dirname "$F")"
( umask 077; printf 'ANTHROPIC_API_KEY=%s\n' "$K" > "$F" )
unset K
echo "Saved. Checking it with Claude..."
R="$(printf '%s' '{"system":"Reply with the single word: ready","messages":[{"role":"user","content":"ping"}],"ping":true}' \
     | "$HOME/alice-web/venv/bin/python" "$HOME/alice-web/claude_worker.py" 2>/dev/null | tail -1)"
case "$R" in
  *'"reply"'*) echo "It works. Alice now thinks with Claude." ;;
  *bad-key*)   echo "Anthropic says that key is not valid. Run this again with the right key."; rm -f "$F" ;;
  *api-4*|*no-access*|*request*) echo "The key was accepted but the call was refused. The account may need a payment method or credits. ($R)" ;;
  *)           echo "The key is saved, but the check did not finish ($R). Alice will keep trying; tell Claude if it stays this way." ;;
esac
