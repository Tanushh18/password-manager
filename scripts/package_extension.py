#!/usr/bin/env python3
"""Packages the Stashr browser extension into a zip ready for the Chrome Web Store upload.

    python3 scripts/package_extension.py            # check and build extension/dist/stashr-extension-<version>.zip
    python3 scripts/package_extension.py --bump patch

It refuses to build when the manifest is wrong, a referenced file is missing, an unexpected file would be shipped,
or a value that looks like a live secret is found in the shipped files. Nothing is uploaded: you upload the zip yourself.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = EXT / "dist"
SHIPPED = {"manifest.json", "popup.html", "popup.js", "popup.css"}
SHIPPED_DIRS = {"icons"}
SECRET_SHAPE = re.compile(r"(sk_live_[0-9A-Za-z]{8,}|AIza[0-9A-Za-z_-]{30,}|ghp_[0-9A-Za-z]{20,}|AKIA[0-9A-Z]{12,}|xox[abp]-[0-9A-Za-z-]{10,})")
VERSION = re.compile(r"^\d+\.\d+\.\d+$")


def fail(message):
    print("FAILED: " + message)
    sys.exit(1)


def load_manifest():
    try:
        return json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        fail("extension/manifest.json is not valid JSON (" + str(error) + ")")


def check_manifest(manifest):
    if manifest.get("manifest_version") != 3:
        fail("manifest_version must be 3 for the Chrome Web Store")
    for key in ("name", "version", "description"):
        if not manifest.get(key):
            fail("manifest is missing '" + key + "'")
    if not VERSION.match(manifest["version"]):
        fail("version must look like 1.2.3, got " + manifest["version"])
    if len(manifest["description"]) > 132:
        fail("description is longer than 132 characters (the store limit)")
    popup = (manifest.get("action") or {}).get("default_popup")
    if popup and not (EXT / popup).exists():
        fail("action.default_popup points at a missing file: " + popup)
    for size, rel in (manifest.get("icons") or {}).items():
        if not (EXT / rel).exists():
            fail("icon " + size + " is missing: " + rel)
    hosts = manifest.get("host_permissions") or []
    if len(hosts) != len(set(hosts)):
        fail("host_permissions lists the same host twice; remove the duplicate")


def shipped_files():
    files = []
    for path in sorted(EXT.rglob("*")):
        if not path.is_file() or OUT in path.parents:
            continue
        rel = path.relative_to(EXT)
        if rel.as_posix() in SHIPPED or rel.parts[0] in SHIPPED_DIRS:
            files.append(rel)
        elif rel.as_posix() not in {"README.md"}:
            print("  not shipped: " + rel.as_posix())
    return files


def check_secrets(files):
    for rel in files:
        if rel.suffix not in {".js", ".html", ".json", ".css"}:
            continue
        text = (EXT / rel).read_text(encoding="utf-8", errors="ignore")
        if SECRET_SHAPE.search(text):
            fail(rel.as_posix() + " contains a value that looks like a live secret. Remove it before uploading.")


def bump(manifest, part):
    major, minor, patch = (int(x) for x in manifest["version"].split("."))
    if part == "major":
        major, minor, patch = major + 1, 0, 0
    elif part == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    manifest["version"] = "%d.%d.%d" % (major, minor, patch)
    (EXT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("version bumped to " + manifest["version"])


def main(argv):
    manifest = load_manifest()
    if "--bump" in argv:
        part = argv[argv.index("--bump") + 1] if argv.index("--bump") + 1 < len(argv) else "patch"
        bump(manifest, part)
        manifest = load_manifest()
    check_manifest(manifest)
    files = shipped_files()
    check_secrets(files)

    OUT.mkdir(exist_ok=True)
    target = OUT / ("stashr-extension-" + manifest["version"] + ".zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel in files:
            archive.write(EXT / rel, rel.as_posix())
    print("built " + str(target) + " (" + str(len(files)) + " files)")
    print("""
Upload checklist (Chrome Web Store developer dashboard):
  1. Upload the zip above as a new version of the existing item (or a new item the first time).
  2. Permissions: justify activeTab, storage and scripting in one line each, matching what the popup does.
  3. Single purpose: say it is Stashr's password autofill and the Stashr account it talks to.
  4. Privacy: you must state what data is handled and link a privacy policy URL.
  5. Store listing: name, short description, at least one screenshot (1280x800 or 640x400).
  6. Submit for review. Review usually takes days; the first submission is the slowest.""")


if __name__ == "__main__":
    main(sys.argv[1:])
