D=/home/squeal-e2e/dogfood-009
find $D/agent $D/home \( -path $D/home/remeda -o -path $D/home/.npm -o -path "$D/home/.local/share/squeal/pi/*/dist" -o -path "$D/home/.local/share/squeal/pi/*/skills" -o -path "$D/agent/sessions" \) -prune -o -print | sort
