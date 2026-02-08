"""
CLI smoke tests for the Gemini-only stack.
"""

from pathlib import Path
import subprocess

import pytest


BASE_PATH = Path(__file__).parent.parent.parent
BACKEND_PATH = BASE_PATH / "backend"
VENV_PATH = BACKEND_PATH / "venv"
VENV_PYTHON = VENV_PATH / "bin" / "python"


def _run_in_venv(code: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(VENV_PYTHON), "-c", code],
        capture_output=True,
        text=True,
        cwd=str(BACKEND_PATH),
    )


def _require_venv() -> None:
    if not VENV_PYTHON.exists():
        pytest.skip(f"venv python not found: {VENV_PYTHON}")


def test_cli_imports() -> None:
    _require_venv()
    result = _run_in_venv(
        "import sys; sys.path.insert(0, '.'); from cli_app import YogaPlatformCLI; print('OK')"
    )
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


def test_required_python_packages_for_gemini_stack() -> None:
    _require_venv()
    code = (
        "import fastapi, uvicorn, PIL; "
        "import google.genai; "
        "print('OK')"
    )
    result = _run_in_venv(code)
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


def test_env_template_does_not_include_legacy_provider_flags() -> None:
    content = (BACKEND_PATH / "cli_app.py").read_text(encoding="utf-8")
    assert "GOOGLE_API_KEY=" in content
    assert "USE_GOOGLE_AI=" not in content


def test_backend_requirements_exclude_sdxl_dependencies() -> None:
    requirements = (BACKEND_PATH / "requirements.txt").read_text(encoding="utf-8")
    lowered = requirements.lower()
    assert "diffusers" not in lowered
    assert "bitsandbytes" not in lowered
    assert "transformers" not in lowered
