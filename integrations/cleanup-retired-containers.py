#!/usr/bin/env python3
"""Archive stopped Fleet ALE containers before removing explicitly selected IDs."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def cleanup(container_id: str, archive: Path, full_filesystem: bool = False):
    metadata = json.loads(subprocess.check_output(["docker", "inspect", container_id], text=True))[0]
    if metadata["State"]["Status"] not in ("exited", "dead"):
        raise ValueError(f"Refusing running container {container_id}")
    name = metadata["Name"].lstrip("/")
    image = metadata["Config"]["Image"]
    if not name.startswith(("ale-", "frontal-")) or not image.startswith(("ale-ubuntu22-dsh-fleet:", "ale-ubuntu22-frontal-team:")):
        raise ValueError(f"Not a recognized retired Fleet ALE container: {container_id}")
    destination = archive / metadata["Id"]
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    archives = []
    if full_filesystem:
        filesystem = destination / "filesystem.tar"
        if not filesystem.exists():
            subprocess.run(["docker", "export", "-o", str(filesystem), metadata["Id"]], check=True)
        archives.append(filesystem)
    else:
        for label, path in (("task-data", "/media/user/data/agenthle"), ("agent-traces", "/home/user/.ale"),
                            ("sessions", "/home/user/.dsh/sessions")):
            artifact = destination / (label + ".tar")
            with artifact.open("wb") as stream:
                result = subprocess.run(["docker", "cp", f"{metadata['Id']}:{path}", "-"], stdout=stream, stderr=subprocess.PIPE)
            if result.returncode:
                artifact.unlink(missing_ok=True)
                if label == "task-data":
                    raise RuntimeError("Required task-data archival failed; container retained")
            else:
                archives.append(artifact)
    checksums = {}
    for artifact in archives:
        digest = hashlib.sha256()
        with artifact.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        checksums[artifact.name] = {"sha256": digest.hexdigest(), "bytes": artifact.stat().st_size}
    record = {"id": metadata["Id"], "name": name, "image": image, "state": metadata["State"],
              "archiveMode": "full-filesystem" if full_filesystem else "task-data-and-agent-traces", "archives": checksums}
    (destination / "manifest.json").write_text(json.dumps(record, indent=2) + "\n")
    with (destination / "docker.log").open("wb") as stream:
        subprocess.run(["docker", "logs", metadata["Id"]], stdout=stream, stderr=subprocess.STDOUT, check=True)
    latest = json.loads(subprocess.check_output(["docker", "inspect", metadata["Id"]], text=True))[0]
    if latest["State"]["Status"] not in ("exited", "dead"):
        raise ValueError("Container restarted during archival; retained")
    subprocess.run(["docker", "rm", metadata["Id"]], check=True)
    print(json.dumps(record))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--full-filesystem", action="store_true", help="Archive the full container filesystem, including its large base OS")
    parser.add_argument("container", nargs="+", help="Explicit IDs; no global prune")
    args = parser.parse_args()
    args.archive.mkdir(parents=True, exist_ok=True, mode=0o700)
    for identifier in args.container:
        cleanup(identifier, args.archive.resolve(), args.full_filesystem)
