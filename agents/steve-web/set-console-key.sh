#!/bin/bash
# Lets Steve change a live price when Aaron asks and confirms. Aaron types the console key here ONCE, hidden.
# The key is kept only in ~/.config/steve/console.key on the Blink (readable by this user only). It is never
# shown, never put in a chat and never copied anywhere else. To take the ability away: delete that file.
set -e
printf '\e]0;Set console key for Steve\a'
echo
echo "  This lets Steve change a price on the live store when you ask him and then say \"yes, change it\"."
echo "  Type the console key (the CONSOLE_KEY of the Creative Lab engine). Nothing shows while you type."
echo
read -rsp "  Console key: " KEY; echo
if [ ${#KEY} -lt 16 ]; then echo "  That is too short to be the console key. Nothing was saved."; read -rp "  Press Enter to close..." _; exit 1; fi
CODE=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "x-console-key: $KEY" "https://creative-lab-engine.business-console.workers.dev/api/handoffs?lane=console")
if [ "$CODE" != "200" ]; then echo "  The engine did not accept that key (answer $CODE). Nothing was saved."; read -rp "  Press Enter to close..." _; exit 1; fi
mkdir -p "$HOME/.config/steve" && chmod 700 "$HOME/.config/steve"
umask 077; printf '%s' "$KEY" > "$HOME/.config/steve/console.key"; unset KEY
echo "  Saved. The engine accepted the key. Steve can now change a price after you confirm it."
read -rp "  Press Enter to close..." _
