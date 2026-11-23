#!/usr/bin/env python3
"""Turn the Agora QLoRA into q4 weights the static site can run.

The site loads a public Hugging Face repo with WebLLM. The wasm library is
already the prebuilt Qwen2.5 1.5B library, so this script only converts
weights. It does not upload anything unless you pass --upload and set HF_TOKEN.

Typical Kaggle use, after training/agona_student_lora.ipynb:

    python publish_agora_web.py --adapter agona-output/agona-student-lora

The published model is named Agora 1.0. Upload agona-output/agora-student-mlc to the repo root, so
mlc-chat-config.json is at the top of the repo.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

BASE_ID = "Qwen/Qwen2.5-1.5B-Instruct"
DEFAULT_ADAPTER = "agona-output/agona-student-lora"
DEFAULT_MERGED = "agona-output/agora-merged"
DEFAULT_MLC = "agona-output/agora-student-mlc"
DEFAULT_REPO = "XxNoelW/Agora-1.0"


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def have_cuda():
    try:
        out = subprocess.run(["nvidia-smi"], capture_output=True, text=True, check=False)
        return out.returncode == 0
    except OSError:
        return False


def install_mlc():
    """Install the nightly that provides convert_weight and gen_config.

    Kaggle GPUs use the CUDA wheel. A machine without a GPU uses the CPU wheel,
    which is enough to quantize weights.
    """
    package = "mlc-llm-nightly-cu128" if have_cuda() else "mlc-llm-nightly-cpu"
    runtime = "mlc-ai-nightly-cu128" if have_cuda() else "mlc-ai-nightly-cpu"
    run([
        sys.executable, "-m", "pip", "install", "--pre", "-U",
        "-f", "https://mlc.ai/wheels", package, runtime,
    ])


def merge_adapter(adapter: Path, merged: Path):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if (merged / "config.json").is_file() and (merged / "model.safetensors").is_file():
        print("merged weights already exist:", merged)
        return
    print("merging", adapter, "into", BASE_ID)
    tokenizer = AutoTokenizer.from_pretrained(BASE_ID, trust_remote_code=False)
    base = AutoModelForCausalLM.from_pretrained(
        BASE_ID,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=False,
    )
    peft = PeftModel.from_pretrained(base, str(adapter))
    model = peft.merge_and_unload()
    merged.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(merged, safe_serialization=True)
    tokenizer.save_pretrained(merged)
    print("merged", merged)


def convert(merged: Path, mlc_dir: Path):
    if mlc_dir.exists():
        shutil.rmtree(mlc_dir)
    mlc_dir.mkdir(parents=True, exist_ok=True)
    run([
        sys.executable, "-m", "mlc_llm", "convert_weight", str(merged),
        "--quantization", "q4f16_1",
        "-o", str(mlc_dir),
    ])
    help_text = subprocess.run(
        [sys.executable, "-m", "mlc_llm", "gen_config", "--help"],
        capture_output=True, text=True, check=False,
    ).stdout
    cmd = [
        sys.executable, "-m", "mlc_llm", "gen_config", str(merged),
        "--quantization", "q4f16_1",
        "--conv-template", "qwen2",
        "-o", str(mlc_dir),
    ]
    if "--context-window-size" in help_text:
        cmd[cmd.index("-o"):cmd.index("-o")] = ["--context-window-size", "4096"]
    if "--prefill-chunk-size" in help_text:
        cmd[cmd.index("-o"):cmd.index("-o")] = ["--prefill-chunk-size", "1024"]
    run(cmd)
    config = mlc_dir / "mlc-chat-config.json"
    if not config.is_file():
        raise SystemExit(f"Missing {config}. The convert step did not finish.")
    text = config.read_text(encoding="utf-8")
    if '"q4f16_1"' not in text or '"qwen2"' not in text:
        raise SystemExit("mlc-chat-config.json is not a qwen2 q4f16_1 model. The site will refuse it.")
    print("mlc weights", mlc_dir)


def upload(mlc_dir: Path, repo: str):
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        raise SystemExit("Set HF_TOKEN in the environment. Do not paste it into the script.")
    run([
        sys.executable, "-m", "pip", "install", "-U", "huggingface_hub",
    ])
    run([
        sys.executable, "-m", "huggingface_hub.commands.huggingface_cli",
        "upload", repo, str(mlc_dir), ".",
        "--repo-type", "model",
        "--commit-message", "Add q4f16_1 WebLLM weights",
    ])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Quantize the Agora student model for the browser.")
    parser.add_argument("--adapter", default=DEFAULT_ADAPTER, help="PEFT adapter directory from the training notebook.")
    parser.add_argument("--merged", default=DEFAULT_MERGED, help="Where to write the merged Hugging Face model.")
    parser.add_argument("--mlc", default=DEFAULT_MLC, help="Where to write the q4f16_1 WebLLM folder.")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Public Hugging Face repo id. Used only with --upload.")
    parser.add_argument("--skip-install", action="store_true", help="Skip the mlc-llm pip install.")
    parser.add_argument("--upload", action="store_true", help="Upload the MLC folder. Requires HF_TOKEN.")
    args = parser.parse_args(argv)

    adapter = Path(args.adapter)
    merged = Path(args.merged)
    mlc_dir = Path(args.mlc)
    if not (merged / "config.json").is_file():
        if not (adapter / "adapter_config.json").is_file():
            raise SystemExit(
                f"No merged model at {merged} and no adapter at {adapter}. "
                "Run the training notebook first, or pass --merged."
            )
        merge_adapter(adapter, merged)
    if not args.skip_install:
        install_mlc()
    convert(merged, mlc_dir)
    print()
    print("Upload this folder to the root of a public model repo:")
    print(" ", mlc_dir.resolve())
    print("The repo id the site expects is:")
    print(" ", args.repo)
    print("mlc-chat-config.json must be at the top of the repo, next to the weight shards.")
    if args.upload:
        upload(mlc_dir, args.repo)
    else:
        print("Nothing was uploaded. Re-run with --upload after you create the public repo and set HF_TOKEN.")


if __name__ == "__main__":
    main()
