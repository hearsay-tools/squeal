# Throwaway: sourced by probe runners. Disables the user's plugins so that
# --dangerously-bypass-hook-trust never runs hooks this probe did not declare.
PROBE_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NOPLUG=(-c 'plugins."superpowers@apptension-dev".enabled=false'
        -c 'plugins."apptension-sdlc@apptension-dev".enabled=false'
        -c 'plugins."apptension-review@apptension-dev".enabled=false')
# h EVENT MODE [MATCHER] [EXTRA] -> one -c pair declaring a hook group
h() { local m=""; [ -n "$3" ] && m="matcher=\"$3\","; echo "hooks.$1=[{${m}hooks=[{type=\"command\",command=\"$PROBE_BIN/hook.sh $1 $2\"${4:+,$4}}]}]"; }
