#!/usr/bin/env python3
"""Offline translation helper backed by argostranslate.

Reads one JSON request on stdin, writes one JSON response on stdout.

Requests:
  {"action": "capabilities"}
    -> {"ok": true, "installed": [["es","en"], ...]}
  {"action": "translate", "from": "es", "to": "fr", "lines": ["...", ...]}
    -> {"ok": true, "lines": ["...", ...]}  (or {"ok": false, "error": "..."})

Language models are downloaded from the argos index on first use, then cached
locally — fully offline thereafter.
"""
import json
import sys

try:
    import argostranslate.package as pkg
    import argostranslate.translate as tr
except Exception as e:  # pragma: no cover
    print(json.dumps({"ok": False, "error": f"argos import failed: {e}"}))
    sys.exit(0)


def installed_pairs():
    pairs = []
    for lang in tr.get_installed_languages():
        for t in lang.translations_from:
            pairs.append([lang.code, t.to_lang.code])
    return pairs


def ensure_pair(frm, to):
    """Install the from->to package, or from->en and en->to for pivoting."""
    have = {(a, b) for a, b in installed_pairs()}
    needed = []
    if (frm, to) not in have:
        # try direct, else pivot through English
        needed = [(frm, to)]
    targets = needed if needed else []
    if (frm, to) in have:
        return
    pkg.update_package_index()
    available = pkg.get_available_packages()

    def find(a, b):
        for p in available:
            if p.from_code == a and p.to_code == b:
                return p
        return None

    direct = find(frm, to)
    chosen = []
    if direct:
        chosen = [direct]
    else:
        p1, p2 = find(frm, "en"), find("en", to)
        if not p1 or not p2:
            raise RuntimeError(f"no translation path {frm}->{to}")
        chosen = [p1, p2]
    for p in chosen:
        if (p.from_code, p.to_code) not in have:
            pkg.install_from_path(p.download())


def main():
    try:
        req = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"bad request: {e}"}))
        return

    action = req.get("action")
    if action == "capabilities":
        print(json.dumps({"ok": True, "installed": installed_pairs()}))
        return

    if action == "translate":
        frm, to = req.get("from", "en"), req.get("to")
        lines = req.get("lines", [])
        if not to:
            print(json.dumps({"ok": False, "error": "missing target language"}))
            return
        if frm == to:
            print(json.dumps({"ok": True, "lines": lines}))
            return
        try:
            ensure_pair(frm, to)
            out = [tr.translate(x, frm, to) for x in lines]
            print(json.dumps({"ok": True, "lines": out}))
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
        return

    print(json.dumps({"ok": False, "error": f"unknown action: {action}"}))


if __name__ == "__main__":
    main()
