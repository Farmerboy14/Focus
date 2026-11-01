#!/bin/bash
set -e
export JAVA_TOOL_OPTIONS=
cd "$(dirname "$0")"
A=tools/android.jar
if [ ! -f "$A" ]; then
  mkdir -p tools
  curl -sSfL -o "$A" https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
fi
KS=${FOCUS_KEYSTORE:-tools/focus.keystore}
rm -rf build && mkdir -p build/gen build/classes
aapt package -f -m -J build/gen -M app/AndroidManifest.xml -S app/res -A app/assets -I $A -F build/res.apk \
  --version-code ${VC:-1} --version-name ${VN:-0.1}
javac -nowarn -Xlint:none -source 8 -target 8 -encoding UTF-8 -bootclasspath $A -d build/classes $(find app/src build/gen -name '*.java') 2>&1 | grep -v "^warning: \[options\]\|^[0-9]* warning" || true
test -f build/classes/com/caleb/focus/HomeActivity.class
dalvik-exchange --dex --min-sdk-version=26 --output=build/classes.dex build/classes
cp build/res.apk build/unsigned.apk
(cd build && zip -q unsigned.apk classes.dex)
zipalign -f 4 build/unsigned.apk build/aligned.apk
apksigner sign --ks "$KS" --ks-pass pass:focuskey --out build/Focus.apk build/aligned.apk
ls -la build/Focus.apk
