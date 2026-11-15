#!/bin/sh
# Feeds Herdr's usage meter: copies Claude Code's rate_limits (5-hour and weekly
# usage) to a file the tokyo-tui bottom bar reads. Prints nothing, so Claude Code's
# own screen is unchanged. Keys can be missing (no reply yet, a window just reset).
out="$HOME/.config/herdr-app/data/claude-usage.json"
jq -c '(.rate_limits // {}) + {updated_at: now}' > "$out.tmp" 2>/dev/null && mv "$out.tmp" "$out"
