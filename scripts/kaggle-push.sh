#!/usr/bin/env bash
# Push the training notebook with the official Kaggle CLI.
# The token stays in the environment. This script never prints it and never writes it to a file.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
notebook="$root/training/agona_student_lora.ipynb"

if [[ ! -f "$notebook" ]]; then
  echo "Notebook not found: training/agona_student_lora.ipynb" >&2
  exit 1
fi

if [[ -z "${KAGGLE_API_TOKEN:-}" ]]; then
  echo "Set KAGGLE_API_TOKEN to your KGAT_ access token in the environment." >&2
  echo "Do not put the token in a file in this repo." >&2
  exit 1
fi

if [[ -z "${KAGGLE_USERNAME:-}" ]]; then
  echo "Set KAGGLE_USERNAME to your public Kaggle name so the kernel can be named." >&2
  echo "That name is not the access token." >&2
  exit 1
fi

if ! command -v kaggle >/dev/null 2>&1; then
  echo "The kaggle command is not installed. Install the official CLI: pip install kaggle" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

cp "$notebook" "$tmpdir/agona_student_lora.ipynb"
python3 - "$tmpdir" <<'PY'
import json, os, sys
folder = sys.argv[1]
user = os.environ["KAGGLE_USERNAME"].strip().strip("/")
meta = {
    "id": f"{user}/agona-student-lora",
    "title": "Agona student LoRA",
    "code_file": "agona_student_lora.ipynb",
    "language": "python",
    "kernel_type": "notebook",
    "is_private": True,
    "enable_gpu": True,
    "enable_internet": True,
    "dataset_sources": [],
    "competition_sources": [],
    "kernel_sources": [],
}
path = os.path.join(folder, "kernel-metadata.json")
with open(path, "w", encoding="utf-8") as handle:
    json.dump(meta, handle, indent=2)
    handle.write("\n")
PY

kaggle kernels push -p "$tmpdir"
echo "Pushed the notebook. The access token was not written to a file."
