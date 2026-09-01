#!/usr/bin/env python3
from __future__ import annotations

import json
import socket
import subprocess


MODEL_HOST = "221.194.152.171"
MODEL_PORT = 443


def can_connect(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def external_dns_resolves() -> bool:
    try:
        result = subprocess.run(
            ["getent", "hosts", "example.com"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except subprocess.TimeoutExpired:
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def effective_capabilities() -> int:
    with open("/proc/self/status", encoding="utf-8") as status:
        for line in status:
            if line.startswith("CapEff:"):
                return int(line.split(":", 1)[1].strip(), 16)
    raise RuntimeError("CapEff is missing from /proc/self/status")


capabilities = effective_capabilities()
checks = {
    "model_tcp_443_allowed": can_connect(MODEL_HOST, MODEL_PORT),
    "model_tcp_80_blocked": not can_connect(MODEL_HOST, 80),
    "other_public_tcp_blocked": not can_connect("1.1.1.1", 443),
    "external_dns_blocked": not external_dns_resolves(),
    "business_container_lacks_net_admin": not bool(capabilities & (1 << 12)),
    "business_container_lacks_net_raw": not bool(capabilities & (1 << 13)),
}

print(json.dumps({"checks": checks}, indent=2, sort_keys=True))
raise SystemExit(0 if all(checks.values()) else 1)
