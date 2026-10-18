#!/bin/bash
set -e
export PATH="/home/sus/.local/bin:/usr/local/bin:/usr/bin:/bin"
export CHROME_PATH="/home/sus/.local/opt/chrome-headless-shell-linux64/chrome-headless-shell"
export LD_LIBRARY_PATH="/home/sus/.local/chrome-libs"
cd /mnt/c/Users/Asus/Desktop/dev/JunctionXTyks
exec "$@"
