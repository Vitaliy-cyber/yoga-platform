#!/usr/bin/env python3
"""
Script to download AI models for the Yoga Pose Platform.

Downloads:
- FLUX.1 Schnell base model
- ControlNet Canny model

Usage:
    python download_models.py
"""

import os
import sys
from pathlib import Path


def check_dependencies():
    """Check if required packages are installed."""
    try:
        import torch
        from huggingface_hub import snapshot_download

        print(f"PyTorch version: {torch.__version__}")
        print(f"CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"CUDA version: {torch.version.cuda}")
            print(f"GPU: {torch.cuda.get_device_name(0)}")
    except ImportError as e:
        print(f"Error: Missing dependency - {e}")
        print("Install with: pip install torch huggingface_hub")
        sys.exit(1)


def download_models(models_dir: Path):
    """Download AI models."""
    from huggingface_hub import snapshot_download

    models_to_download = [
        {
            "repo_id": "black-forest-labs/FLUX.1-schnell",
            "local_dir": models_dir / "flux",
            "description": "FLUX.1 Schnell base model",
        },
        {
            "repo_id": "xlabs-ai/flux-controlnet-canny",
            "local_dir": models_dir / "controlnet",
            "description": "ControlNet Canny model",
        },
    ]

    for model in models_to_download:
        print(f"\n{'=' * 60}")
        print(f"Downloading: {model['description']}")
        print(f"From: {model['repo_id']}")
        print(f"To: {model['local_dir']}")
        print("=" * 60)

        try:
            snapshot_download(
                repo_id=model["repo_id"],
                local_dir=str(model["local_dir"]),
                local_dir_use_symlinks=False,
            )
            print(f"Successfully downloaded {model['description']}")
        except Exception as e:
            print(f"Error downloading {model['description']}: {e}")
            print("You may need to accept the model license on Hugging Face first.")


def main():
    print("=" * 60)
    print("Yoga Pose Platform - AI Model Downloader")
    print("=" * 60)

    # Check dependencies
    check_dependencies()

    # Determine models directory
    script_dir = Path(__file__).parent
    models_dir = script_dir.parent / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nModels directory: {models_dir}")

    # Estimate required space
    print("\nEstimated storage requirements:")
    print("- FLUX.1 Schnell: ~23GB")
    print("- ControlNet Canny: ~3GB")
    print("- Total: ~26GB")

    response = input("\nProceed with download? (y/n): ")
    if response.lower() != "y":
        print("Download cancelled.")
        return

    # Download models
    download_models(models_dir)

    print("\n" + "=" * 60)
    print("Download complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
