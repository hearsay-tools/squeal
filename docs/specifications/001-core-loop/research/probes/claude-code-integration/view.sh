#!/bin/bash
# Throwaway: compact view of a stream-json transcript.
jq -c '
 if .type=="system" and .subtype=="init" then {init:{tools:.tools,model:.model,cc:.claude_code_version}}
 elif .type=="system" then {sys:.subtype, hook:(.hook_name//.hook_event//null), out:((.output//.stdout//"")|tostring|.[0:300]), exit:(.exit_code//null), outcome:(.outcome//null)}
 elif .type=="assistant" then {asst:[.message.content[]|if .type=="text" then {text:.text[0:400]} elif .type=="tool_use" then {tool_use:.name,input:(.input|tostring|.[0:200])} else {t:.type} end]}
 elif .type=="user" then {user:[.message.content[]?|if .type=="tool_result" then {tool_result:((.content|tostring)[0:500]),is_error:.is_error} elif .type=="text" then {text:.text[0:500]} else {t:.type} end]}
 elif .type=="result" then {result:.result[0:800],turns:.num_turns,ms:.duration_ms}
 else {other:.type} end' "$1"
