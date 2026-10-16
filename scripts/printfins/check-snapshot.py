"""Verify the vendored snapshot, optionally against the untouched original folder."""
import hashlib
import json
import pathlib
import sys

snapshot = pathlib.Path(__file__).resolve().parents[2] / "resources/printfins/vendor"
manifest = json.loads((snapshot / "ORIGIN.json").read_text(encoding="utf-8"))
roots = [snapshot] + ([pathlib.Path(sys.argv[1])] if len(sys.argv) > 1 else [])
for root in roots:
    for name, expected in manifest["files"].items():
        actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"Snapshot mismatch: {root / name}")
    print(f"PASS: {len(manifest['files'])} unchanged files in {root}")
