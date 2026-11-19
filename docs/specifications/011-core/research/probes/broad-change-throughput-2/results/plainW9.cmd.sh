cd '~/work/011-400/squawk'
exec /usr/bin/time -f "cpu_s=%U+%S wall=%e" -o '~/work/011-400/out/plainW9.vitest.time' timeout 3600 node_modules/.bin/vitest run --project contract --project server --project web  --maxWorkers=9 --reporter=dot --passWithNoTests $(cat '~/work/011-400/out/plainW9.files.txt') > '~/work/011-400/out/plainW9.vitest.log' 2>&1
