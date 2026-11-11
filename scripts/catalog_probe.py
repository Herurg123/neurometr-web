#!/usr/bin/env python3
"""Small, read-only upstream metadata probe. No weights, model inference or credentials.

B3.1 one-off research via GitHub Actions. Never execute untrusted URLs from JSON;
the two HTTPS repository IDs and exact requested file paths are literals here.
"""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://huggingface.co"
REPOS = (
    ("Qwen/Qwen2.5-0.5B-Instruct-GGUF", "qwen2.5-0.5b-instruct-q4_k_m.gguf"),
    ("Qwen/Qwen2.5-1.5B-Instruct-GGUF", "qwen2.5-1.5b-instruct-q4_k_m.gguf"),
)
LIMIT = 750_000
HEADERS = {"User-Agent": "Neurometr-B3.1-metadata-only/0.1.0", "Accept": "application/json,text/plain"}


def read_small(relative: str) -> bytes:
    url = BASE + relative
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError(f"Unexpected status {response.status} for {relative}")
        content = response.read(LIMIT + 1)
        if len(content) > LIMIT:
            raise ValueError(f"Metadata response too large: {relative}")
        return content


def probe(repo: str, filename: str, fetched_at: str) -> dict:
    model = json.loads(read_small(f"/api/models/{repo}?blobs=true"))
    revision = model.get("sha")
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError(f"No immutable full revision for {repo}: {revision!r}")
    tree = json.loads(read_small(f"/api/models/{repo}/tree/{revision}?recursive=false"))
    entries = [v for v in tree if v.get("path") == filename]
    if len(entries) != 1:
        raise ValueError(f"Artifact missing or ambiguous for {repo}: {filename}; tree fields={[(e.get('path'),e.get('size')) for e in tree[:15]]}")
    artifact = entries[0]
    card = model.get("cardData") or {}
    lic = card.get("license")
    license_bytes = read_small(f"/{repo}/raw/{revision}/LICENSE")
    readme = read_small(f"/{repo}/raw/{revision}/README.md").decode("utf-8", errors="strict")
    license_verified = (
        lic == "apache-2.0" and
        b"Apache License" in license_bytes and b"Version 2.0" in license_bytes
    )
    lfs = artifact.get("lfs") or {}
    oid = lfs.get("oid")
    if oid and oid.startswith("sha256:"):
        oid = oid.split(":", 1)[1]
    size = artifact.get("size")
    if size is None:
        size = lfs.get("size")
    file_sha = oid if isinstance(oid, str) and re.fullmatch("[0-9a-f]{64}", oid) else None
    if not isinstance(size, int) or size < 1:
        size = None

    # Model card provides 32,768 context and rounded parameters, not precise count.
    has_context_32768 = bool(re.search(r"32[, ]?768\s+tokens", readme, flags=re.I))
    has_quant_table = bool(re.search(r"q4[_-]k[_-]m", readme, flags=re.I))
    result = {
        "repo": repo, "filename": filename, "revision": revision,
        "fetched_at": fetched_at,
        "source_url": f"{BASE}/{repo}/tree/{revision}",
        "readme_url": f"{BASE}/{repo}/blob/{revision}/README.md",
        "license_url": f"{BASE}/{repo}/blob/{revision}/LICENSE",
        "artifact_url": f"{BASE}/{repo}/resolve/{revision}/{filename}",
        "artifact_page_url": f"{BASE}/{repo}/blob/{revision}/{filename}",
        "artifact_size_bytes": size, "artifact_sha256": file_sha,
        "repository_license_tag": lic, "apache_license_confirmed": license_verified,
        "card_context_32768": has_context_32768,
        "card_quant_q4_k_m": has_quant_table,
        "model_api_keys": sorted(model.keys())[:60],
        "artifact_entry": artifact,
    }
    return result


def main():
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    result = {"fetched_at": stamp, "probe_version": "b3.1-1", "sources": []}
    for repo, filename in REPOS:
        obj = probe(repo, filename, stamp)
        result["sources"].append(obj)
        print("REPO_SOURCE", json.dumps({k: v for k, v in obj.items() if k != "artifact_entry" and k != "model_api_keys"}, ensure_ascii=False, sort_keys=True))
        print("API_ARTIFACT_ENTRY", json.dumps(obj["artifact_entry"], ensure_ascii=False, sort_keys=True))
    out = Path("catalog/research/official-metadata.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("METADATA_RESULT_FILE", str(out))


if __name__ == "__main__":
    main()
