#!/usr/bin/env bash
# Opens Google sign-in for Alice (mail and calendar). Run from the desktop button.
cd "$HOME/qwen-google" && node auth.mjs
echo
read -r -p "Done. Press Enter to close." _
