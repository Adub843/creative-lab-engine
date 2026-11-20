#!/usr/bin/env bash
# Aaron runs this himself on the Blink. The key is typed hidden, saved where only his user can read it,
# and is never shown, logged or sent anywhere except to Anthropic when Alice answers.
# 2026-11-19: it now opens a normal pop-up box (Ctrl+V works there; in a terminal it does not), and says plainly
# when what was pasted is a web link and not a key.
set -u
F="$HOME/.config/alice/claude.env"
TITLE="Give Alice her Claude key"
HOW="Get the key at  platform.claude.com/settings/keys  (press Create key, then Copy).
It is one long line that starts with  sk-ant-"

gui() { [ -n "${WAYLAND_DISPLAY:-}${DISPLAY:-}" ] && command -v zenity >/dev/null 2>&1; }
say() {   # say <info|error> <text>
  if gui; then zenity "--$1" --title="$TITLE" --width=460 --text="$2" 2>/dev/null; else echo; printf "%b
" "$2"; fi
}

if gui; then
  K="$(zenity --entry --hide-text --title="$TITLE" --width=520 \
        --text="Paste the key here (Ctrl+V) and press OK. It stays hidden.\n\n$HOW" 2>/dev/null)" || exit 0
else
  echo "$TITLE"; echo "-------------------------"; echo "$HOW"
  echo "Paste with Ctrl+Shift+V or right-click, Paste (plain Ctrl+V does not paste in a terminal). Nothing shows. Press Enter."
  read -r -s -p "Key: " K; echo
fi

K="$(printf '%s' "$K" | tr -d '[:space:][:cntrl:]')"
case "$K" in *sk-ant-*) K="sk-ant-${K#*sk-ant-}" ;; esac      # drop anything stuck in front of the key
case "$K" in
  sk-ant-*) ;;
  "")       say error "Nothing was pasted, so nothing was saved.\n\nCopy the key first, then run this again and press Ctrl+V."; exit 1 ;;
  http*|*claude.com*|*anthropic.com*|*/*)
            say error "That is a web link, not the key. Nothing was saved.\n\nOpen the link, press Create key, then press Copy on the key itself.\n\n$HOW"; exit 1 ;;
  *)        say error "That does not look like the key. Nothing was saved.\n\n$HOW"; exit 1 ;;
esac

mkdir -p "$(dirname "$F")"
chmod 700 "$(dirname "$F")"
( umask 077; printf 'ANTHROPIC_API_KEY=%s\n' "$K" > "$F" )
unset K
R="$(printf '%s' '{"system":"Reply with the single word: ready","messages":[{"role":"user","content":"ping"}],"ping":true}' \
     | "$HOME/alice-web/venv/bin/python" "$HOME/alice-web/claude_worker.py" 2>/dev/null | tail -1)"
case "$R" in
  *'"reply"'*) say info "It works. Alice now thinks with Claude." ;;
  *bad-key*)   rm -f "$F"; say error "Anthropic says that key is not valid. Nothing was saved.\n\nMake a new key and run this again." ;;
  *api-4*|*no-access*|*request*)
               say error "The key was accepted, but Anthropic refused the call.\n\nThe account most likely needs a payment method or credits: platform.claude.com, Billing.\n\nThe key is saved, so nothing more to do here once billing is set." ;;
  *)           say error "The key is saved, but the check did not finish. Alice will keep trying.\n\nTell Claude if she is not faster in a few minutes." ;;
esac
