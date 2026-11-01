#!/bin/bash
# Usage: ./release.sh <versionCode> <versionName> "<short note shown on the phone>"
set -e
cd "$(dirname "$0")"
VC=$1 VN=$2 ./build.sh
mkdir -p release
cp build/Focus.apk release/Focus.apk
python3 - "$1" "$2" "$3" <<'PY'
import json, sys
json.dump({"code": int(sys.argv[1]), "name": sys.argv[2], "notes": sys.argv[3],
           "apk": "https://raw.githubusercontent.com/Farmerboy14/focus/main/release/Focus.apk"},
          open("release/version.json", "w"), indent=2)
PY
cat release/version.json
