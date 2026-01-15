#!/usr/bin/env python3
"""
Script to test AI generation for the Yoga Pose Platform.

Usage:
    python test_generation.py --input path/to/schema.png --output path/to/output.png
"""

import argparse
import os
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "backend"))


def test_generation(input_path: str, output_path: str, layer_type: str = "photo"):
    """Test image generation."""
    print("=" * 60)
    print("Testing AI Generation")
    print("=" * 60)

    # Check input file
    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}")
        return False

    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    print(f"Layer type: {layer_type}")

    try:
        import torch

        print(f"\nPyTorch version: {torch.__version__}")
        print(f"CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            print(f"GPU: {torch.cuda.get_device_name(0)}")
            print(
                f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB"
            )
    except ImportError:
        print("PyTorch not installed")
        return False

    print("\nLoading AI generator...")

    try:
        from services.ai_generator import AIGenerator

        generator = AIGenerator.get_instance()
        print("Generator loaded successfully!")

        print("\nGenerating image...")
        import asyncio

        async def generate():
            if layer_type == "photo":
                await generator.generate_photo(input_path, output_path, "test")
            elif layer_type == "muscles":
                await generator.generate_muscles(input_path, output_path, "test")
            elif layer_type == "skeleton":
                await generator.generate_skeleton(input_path, output_path, "test")

        asyncio.run(generate())

        if os.path.exists(output_path):
            print(f"\nSuccess! Output saved to: {output_path}")
            return True
        else:
            print("\nError: Output file was not created")
            return False

    except Exception as e:
        print(f"\nError during generation: {e}")
        import traceback

        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Test AI generation")
    parser.add_argument(
        "--input", "-i", required=True, help="Path to input schema image"
    )
    parser.add_argument("--output", "-o", required=True, help="Path to output image")
    parser.add_argument(
        "--type",
        "-t",
        choices=["photo", "muscles", "skeleton"],
        default="photo",
        help="Type of generation",
    )

    args = parser.parse_args()

    success = test_generation(args.input, args.output, args.type)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
