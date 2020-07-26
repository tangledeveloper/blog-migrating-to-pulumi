#!/bin/bash

set -o errexit # Exit on error
CWD=$(pwd)
BUILD_PATH_LAYERS=$CWD/layers
cd $CWD

# Package typescript code
npm install --prefer-offline
npm run build

echo "zip build directory"
cd build
zip -q -r archive.zip functions/*

# Package node_modules
mkdir -p $BUILD_PATH_LAYERS
cp $CWD/package.json $BUILD_PATH_LAYERS/package.json

cd $BUILD_PATH_LAYERS
echo "installing production only dependencies"
npm install --production --prefer-offline

echo "zip node_modules directory"
mkdir -p ./nodejs
mv node_modules nodejs/node_modules
zip -q -r archive.zip *
rm -rf nodejs

echo "exiting to root directory"
cd $CWD

echo "Done."
