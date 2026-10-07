#!/bin/sh
# Throwaway: log the event name, PLUGIN_ROOT and PATH seen by a plugin hook.
ev=$(cat | sed -n 's/.*"hook_event_name":"\([A-Za-z]*\)".*/\1/p')
echo "$(date +%s%3N) plugin-hook $ev PLUGIN_ROOT=$PLUGIN_ROOT PLUGIN_DATA=$PLUGIN_DATA" >> /tmp/csw/logs/plugin.log
if [ "$ev" = SessionStart ]; then printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Plugin probe primer: nonce PLUG-3131."}}'; fi
