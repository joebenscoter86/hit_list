#!/bin/bash
PORT=$(jq -r .port "$HOME/.hit-list/state.json" 2>/dev/null)
if [ -z "$PORT" ] || [ "$PORT" = "null" ]; then
  echo "hit-list server not running"
  exit 1
fi
open "http://localhost:$PORT"
