"""B3.2 isolated Windows runner: create and verify a genuine ordinary Agent report.

The report is NEVER committed, uploaded, printed or published. All child-process
stdout/stderr and validator errors are withheld even if a check fails.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

WEB = Path(__file__).resolve().parents[1]
AGENT = WEB / "agent-readonly"
EXPECTED_AGENT_COMMIT = "f63d38fa8018572f570d60f6bf652ee2bb7e64c3"
EXPECTED_WEB_CATALOG_COMMIT = "bb828bb09372e16cf63d04371d5f9367eee2526e"
CATALOG_SHA = "1d84ff596c589a4db004f8a3fa17490d5479f57db3d7b0a433a7e448289651d2"
CATALOG_VERSION = "2026.11.11.2"
CATALOG_BYTES = 6589
PRIVATE = Path(os.environ["RUNNER_TEMP"]) / "neurometr-b32-private"
OUTPUT = PRIVATE / "diagnostic.json"
STAGE = "init"

def mark(stage):
    global STAGE
    STAGE = stage


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def run_silent(args, *, cwd, input_bytes=None, timeout=180):
    completed = subprocess.run(args, cwd=cwd, input=input_bytes,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               timeout=timeout, check=False)
    require(completed.returncode == 0, "isolated child command failed")
    return completed.stdout


def main():
    require(sys.platform == "win32", "Windows 2025 x64 runner required")
    require(not PRIVATE.exists(), "stale private directory")
    PRIVATE.mkdir(parents=True, mode=0o700)
    mark("checkout")
    require(AGENT.is_dir(), "pinned Agent checkout missing")
    source_sha = run_silent(["git", "rev-parse", "HEAD"], cwd=AGENT).strip().decode("ascii")
    require(source_sha == EXPECTED_AGENT_COMMIT, "Agent commit mismatch")

    # Approved source catalog is a Web-main file, unchanged in B3.2.
    mark("catalog_pin")
    original_web_catalog = WEB / "catalog" / "versions" / CATALOG_VERSION / "catalog.json"
    web_catalog = original_web_catalog.read_bytes()
    agent_catalog = (AGENT / "bundled" / "catalog.json").read_bytes()
    # Exact git blob is the immutable reference. Checkout working trees on
    # Windows may convert LF -> CRLF unless attributes force eol=lf.
    blob = run_silent(
        ["git", "show", "HEAD:catalog/versions/" + CATALOG_VERSION + "/catalog.json"],
        cwd=WEB,
    )
    attr = run_silent(
        ["git", "check-attr", "eol", "--",
         "catalog/versions/" + CATALOG_VERSION + "/catalog.json"],
        cwd=WEB,
    )
    good_blob = len(blob) == CATALOG_BYTES and hashlib.sha256(blob).hexdigest() == CATALOG_SHA
    good_web = len(web_catalog) == CATALOG_BYTES and hashlib.sha256(web_catalog).hexdigest() == CATALOG_SHA
    good_agent = len(agent_catalog) == CATALOG_BYTES and hashlib.sha256(agent_catalog).hexdigest() == CATALOG_SHA
    equal = web_catalog == agent_catalog == blob
    eol_lf = attr.strip().endswith(b": lf")
    # These public catalog byte counts and PASS/FAIL labels are safe for logs;
    # the catalog content and actual runner hardware are never printed.
    print(
        "B32_WINDOWS_CATALOG_WEB_BYTES=" + str(len(web_catalog)) +
        " WEB_SHA256=" + ("PASS" if good_web else "FAIL") +
        " AGENT_BYTES=" + str(len(agent_catalog)) +
        " AGENT_SHA256=" + ("PASS" if good_agent else "FAIL") +
        " GIT_BLOB_SHA256=" + ("PASS" if good_blob else "FAIL") +
        " BYTE_EQUAL=" + ("PASS" if equal else "FAIL") +
        " WEB_EOL_LF=" + ("PASS" if eol_lf else "FAIL"),
        flush=True,
    )
    if blob == agent_catalog and web_catalog != blob and web_catalog.replace(b"\r\n", b"\n") == blob:
        print("B32_WINDOWS_CATALOG_CRLF_DRIFT=DETECTED", flush=True)
    require(good_blob and good_web and good_agent and equal and eol_lf,
            "Windows catalog checkout integrity failed")
    lock = json.loads((AGENT / "bundled" / "catalog.lock.json").read_bytes())
    require(lock["source_commit"] == EXPECTED_WEB_CATALOG_COMMIT and
            lock["catalog_version"] == CATALOG_VERSION and
            lock["sha256"] == CATALOG_SHA and
            lock["size_bytes"] == CATALOG_BYTES, "Agent catalog lock mismatch")

    binaries = {
        "diagnose": PRIVATE / "diagnose.exe",
        "validate": PRIVATE / "contractvalidate.exe",
        "pin": PRIVATE / "catalogcheck.exe",
    }
    for name, path in binaries.items():
        mark("go_build_" + name)
        run_silent(["go", "build", "-o", str(path), "./cmd/" +
                    {"diagnose": "diagnose", "validate": "contractvalidate", "pin": "catalogcheck"}[name]],
                   cwd=AGENT, timeout=240)
    mark("catalog_pin_binary")
    run_silent([str(binaries["pin"]), "-root", str(AGENT)], cwd=AGENT)
    env = dict(os.environ)
    env.pop("NEUROMETR_A3_TEST_ONLY", None)
    env.pop("NEUROMETR_CATALOG_PATH", None)
    # No test-only flag, no -catalog override, no optional llmfit binary.
    mark("native_export")
    completed = subprocess.run(
        [str(binaries["diagnose"]), "-root", str(AGENT), "-output", str(OUTPUT)],
        cwd=AGENT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=95, check=False,
    )
    require(completed.returncode == 0 and OUTPUT.is_file(), "ordinary native export failed")
    require(b"A3_2_REPORT_VALID=true" in completed.stdout, "native exporter verdict missing")
    raw = OUTPUT.read_bytes()
    require(0 < len(raw) <= 2 * 1024 * 1024, "diagnostic size invalid")
    mark("go_validation")
    outcome_raw = run_silent([str(binaries["validate"]), "-root", str(AGENT),
                              "-kind", "diagnostic"], cwd=AGENT, input_bytes=raw)
    require(json.loads(outcome_raw)["valid"] is True, "Go FullValidator rejected diagnostic")

    # Independently verify exact canonical Web Python oracle, not merely JSON.parse.
    mark("python_oracle")
    sys.path.insert(0, str(WEB / "contracts" / "tests"))
    from test_contracts import LIMIT_DIAGNOSTIC, decode_bounded, validate
    report = decode_bounded(raw, LIMIT_DIAGNOSTIC)
    validate("diagnostic", report)
    mark("report_fields")
    require(report["kind"] == "neurometr.diagnostic" and
            report["schema_version"] == "0.1.0", "wrong kind/version")
    require(report["catalog_ref"] == {
        "version": CATALOG_VERSION,
        "sha256": CATALOG_SHA,
        "origin": "bundled",
        "compatibility": "passed",
    }, "wrong catalog reference")
    require(report["producer"]["name"] == "neurometr-agent" and
            report["producer"]["platform"] == "windows-x64", "producer mismatch")
    hw = report["hardware"]
    require(hw["os"]["family"] == "windows" and hw["os"]["arch"] == "x64", "Windows source mismatch")
    require(hw["cpu"]["logical_processors"] is not None and
            hw["ram"]["physical_total_bytes"] is not None, "native hardware incomplete")
    require(hw["npus"] == [], "unexpected claim about NPU detection")
    require(all(g["memory"]["dedicated_available_bytes"] is None for g in hw["gpus"]),
            "unmeasured free VRAM treated as known")
    require(report["model_assessments"] == [] and report["runtime_checks"] == [] and
            report["engines"] == [] and report["cloud_checks"] == [],
            "models, runtime or cloud checks were unexpectedly executed")
    statuses = {c["component"]: c["status"] for c in report["components"]}
    require(statuses.get("llmfit") == "skipped" and statuses.get("cloud") == "skipped",
            "nonrequested llmfit/cloud not skipped")
    require(statuses.get("hardware") in ("ok", "partial") and
            report["overall_status"] in ("ok", "partial"), "hardware unavailable")
    require(report["limitations"] and
            not any("TEST ONLY" in item for item in report["limitations"]), "test-only report or missing limitations")
    require(not any("TEST ONLY" in item for item in report["limitations"]), "test-only limitations")
    # Block structural PII markers, sensitive paths and secrets. Never print raw.
    sensitive = [br'"hostname"', br'"username"', br'"serial_number"', br'"mac_address"',
                 br'"ip_address"', br'GITHUB_TOKEN', br'USERPROFILE', br'\\\\Users\\\\',
                 br'private_key', br'client_secret', br'Bearer\s+[A-Za-z0-9]']
    require(all(not re.search(p, raw, re.I) for p in sensitive), "privacy marker detected")
    print("B32_AGENT_HEAD_PIN=PASS")
    print("B32_WEB_AGENT_CATALOG_PIN=PASS")
    print("B32_NATIVE_ORDINARY_JSON=PASS")
    print("B32_GO_FULL_VALIDATOR=PASS")
    print("B32_WEB_PYTHON_ORACLE=PASS")
    print("B32_NO_LLMFIT_OR_MODEL_TPS=PASS")
    print("B32_NATIVE_PII_GUARD=PASS")
    # OUTPUT remains in RUNNER_TEMP only until browser test and always-cleanup.
    # No hardware model names, amounts, JSON, usernames or private paths printed.


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        # Preserve failure exit code without leaking raw exception/paths/stderr.
        print("B32_PRIVATE_REPORT_CREATION=FAIL_REDACTED STAGE=" + STAGE, file=sys.stderr)
        shutil.rmtree(PRIVATE, ignore_errors=True)
        sys.exit(1)
