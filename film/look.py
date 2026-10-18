#!/usr/bin/env python3
"""
film/look.py — Forwarder to root look.py.
"""
import sys, os
script_dir = os.path.dirname(os.path.abspath(__file__))
root_look = os.path.join(script_dir, "..", "look.py")
if os.path.exists(root_look):
    with open(root_look, "r", encoding="utf-8") as f:
        code = f.read()
    exec(compile(code, root_look, "exec"))
else:
    print("look.py not found at repo root", file=sys.stderr)
    sys.exit(1)
