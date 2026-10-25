#!/bin/bash

url="$1"
host=$(echo "$url" | sed -E 's#^https?://##; s#/.*$##')
hdr=$(mktemp)
body=$(mktemp)

res=$(curl -4 -sS -L --max-time 12 --connect-timeout 8 \
  -A "$APP_UA" \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' \
  -H 'Accept-Language: en-US,en;q=0.9' \
  -H 'Sec-Fetch-Dest: document' \
  -H 'Sec-Fetch-Mode: navigate' \
  -H 'Sec-Fetch-Site: none' \
  -D "$hdr" -o "$body" -w '%{http_code} %{size_download} %{time_total}' "$url" 2>/dev/null)
rc=$?
if [ $rc -ne 0 ]; then res="ERR($rc) 0 0"; fi

flags=$(grep -iEo 'just a moment|cf-chl|attention required|access denied|error code: 1026|enable javascript|challenge-platform|cf-challenge' "$body" 2>/dev/null | sort -u | tr '\n' ';' | sed 's/;$//')
cf=$(grep -iE '^(server|cf-ray|cf-mitigated):' "$hdr" 2>/dev/null | tr '\n' ';' | tr -d '\r')

printf '%s|%s|%s|%s\n' "$host" "$res" "$flags" "$cf" > "/tmp/probe/$host"
rm -f "$hdr" "$body"
