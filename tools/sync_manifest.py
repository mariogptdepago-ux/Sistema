#!/usr/bin/env python3
from pathlib import Path
import os, urllib.request

ROOT = Path(__file__).resolve().parents[1]
manifest_path = ROOT / "site" / "apps-manifest.json"
api = os.environ.get("PUBLIC_API_BASE", "").rstrip("/")
secret = os.environ.get("SYNC_SECRET", "")

if not api or "CHANGE-ME" in api or not secret:
    print("SYNC OMITIDO: configure PUBLIC_API_BASE y SYNC_SECRET en GitHub.")
    raise SystemExit(0)

req = urllib.request.Request(
    api + "/api/admin/sync-apps",
    data=manifest_path.read_bytes(),
    method="POST",
    headers={
        "Content-Type": "application/json",
        "X-Sync-Secret": secret,
        "User-Agent": "github-actions-app-sync/1.0",
    },
)
with urllib.request.urlopen(req, timeout=30) as r:
    print(r.read().decode("utf-8"))
