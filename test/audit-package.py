"""Inspect the actual npm tarball without extracting it."""

import argparse
import pathlib
import re
import tarfile


parser = argparse.ArgumentParser()
parser.add_argument("package", type=pathlib.Path)
parser.add_argument("--private-value-file", type=pathlib.Path)
args = parser.parse_args()

needles = []
if args.private_value_file:
    needles.append(args.private_value_file.read_bytes().strip())

files = []
hits = []
with tarfile.open(args.package, "r:gz") as archive:
    for item in archive:
        if not item.isfile():
            continue
        files.append(item.name)
        if not item.name.startswith("package/") or ".." in pathlib.PurePosixPath(item.name).parts:
            hits.append(item.name)
            continue
        content = archive.extractfile(item).read()
        if any(value and value in content for value in needles):
            hits.append(item.name)
        if re.search(rb"sk-[A-Za-z0-9_-]{8,}|[A-Za-z]:\\|/opt/dsh-voice-lab|\b[a-z0-9-]+\.top\b|\b[1-9][0-9]{9,10}\b", content):
            hits.append(item.name)

licenses = sum(pathlib.PurePosixPath(name).name.upper().startswith("LICENSE") for name in files)
print(f"files={len(files)} licenses={licenses} privacy_hits={len(set(hits))}")
if hits:
    raise SystemExit("package audit failed")
