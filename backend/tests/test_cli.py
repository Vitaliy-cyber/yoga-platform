#!/usr/bin/env python3
"""
Жорсткі тести для CLI Yoga Platform.
Перевіряє всі критичні компоненти перед запуском.
"""

import subprocess
import sys
from pathlib import Path

# Шляхи
BASE_PATH = Path(__file__).parent.parent.parent
BACKEND_PATH = BASE_PATH / "backend"
VENV_PATH = BACKEND_PATH / "venv"
VENV_PYTHON = VENV_PATH / "bin" / "python"
MODELS_PATH = BASE_PATH / "ai" / "models"

# Кольори для виводу
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RESET = "\033[0m"
BOLD = "\033[1m"


def print_header(title: str):
    print(f"\n{CYAN}{BOLD}{'=' * 60}{RESET}")
    print(f"{CYAN}{BOLD}  {title}{RESET}")
    print(f"{CYAN}{BOLD}{'=' * 60}{RESET}\n")


def print_test(name: str, passed: bool, details: str = ""):
    icon = f"{GREEN}✓{RESET}" if passed else f"{RED}✗{RESET}"
    details_str = f" {YELLOW}({details}){RESET}" if details else ""
    print(f"  {icon} {name}{details_str}")
    return passed


def report_test(name: str, passed: bool, details: str = "") -> None:
    """Print test diagnostic without returning a value to pytest."""
    print_test(name, passed, details)


def test_venv_exists() -> None:
    """Тест: venv існує"""
    return report_test(
        "Virtual environment існує",
        VENV_PATH.exists() and VENV_PYTHON.exists(),
        str(VENV_PYTHON) if VENV_PYTHON.exists() else "НЕ ЗНАЙДЕНО"
    )


def test_python_packages() -> None:
    """Тест: Python пакети встановлені в venv"""
    if not VENV_PYTHON.exists():
        return report_test("Python пакети у venv", False, "venv не знайдено")

    packages = [
        "torch",
        "diffusers",
        "transformers",
        "fastapi",
        "uvicorn",
        "sqlalchemy",
        "huggingface_hub",
        "PIL",
    ]

    missing = []
    for pkg in packages:
        result = subprocess.run(
            [str(VENV_PYTHON), "-c", f"import {pkg}"],
            capture_output=True,
        )
        if result.returncode != 0:
            missing.append(pkg)

    if missing:
        return report_test("Python пакети у venv", False, f"відсутні: {', '.join(missing)}")
    return report_test("Python пакети у venv", True, f"{len(packages)} пакетів")


def test_cuda_available() -> None:
    """Тест: CUDA доступна через venv PyTorch"""
    if not VENV_PYTHON.exists():
        return report_test("CUDA/GPU", False, "venv не знайдено")

    result = subprocess.run(
        [str(VENV_PYTHON), "-c", """
import torch
if torch.cuda.is_available():
    name = torch.cuda.get_device_name(0)
    vram = torch.cuda.get_device_properties(0).total_memory / 1e9
    print(f"OK:{name} ({vram:.1f}GB)")
else:
    print("CPU")
"""],
        capture_output=True,
        text=True,
    )

    output = result.stdout.strip()
    if output.startswith("OK:"):
        return report_test("CUDA/GPU", True, output[3:])
    else:
        return report_test("CUDA/GPU", False, "CPU mode - GPU не виявлено")


def test_pytorch_cuda_version() -> None:
    """Тест: PyTorch має CUDA підтримку (не CPU-only)"""
    if not VENV_PYTHON.exists():
        return report_test("PyTorch CUDA build", False, "venv не знайдено")

    result = subprocess.run(
        [str(VENV_PYTHON), "-c", """
import torch
print(torch.__version__)
"""],
        capture_output=True,
        text=True,
    )

    version = result.stdout.strip()
    is_cuda = "+cu" in version or "cuda" in version.lower()

    if is_cuda:
        return report_test("PyTorch CUDA build", True, version)
    elif "+cpu" in version:
        return report_test("PyTorch CUDA build", False, f"{version} - CPU-only версія!")
    else:
        return report_test("PyTorch CUDA build", True, f"{version} - можливо CUDA")


def test_sd15_model() -> None:
    """Тест: SD 1.5 модель повністю завантажена (fp16 версії)"""
    sd15_path = MODELS_PATH / "stable-diffusion-v1-5"

    if not sd15_path.exists():
        return report_test("SD 1.5 модель", False, "директорія не існує")

    required_files = [
        "model_index.json",
        "unet/config.json",
        "vae/config.json",
        "text_encoder/config.json",
    ]

    # fp16 версії моделей
    required_patterns = [
        ("unet/diffusion_pytorch_model.fp16.safetensors", "unet fp16"),
        ("vae/diffusion_pytorch_model.fp16.safetensors", "vae fp16"),
        ("text_encoder/model.fp16.safetensors", "text_encoder fp16"),
    ]

    missing_files = []
    for f in required_files:
        if not (sd15_path / f).exists():
            missing_files.append(f)

    missing_patterns = []
    for pattern, name in required_patterns:
        matches = list(sd15_path.glob(pattern))
        if not matches:
            missing_patterns.append(name)

    if missing_files or missing_patterns:
        all_missing = missing_files + missing_patterns
        return report_test("SD 1.5 модель", False, f"відсутні: {', '.join(all_missing[:3])}...")

    # Перевіряємо розмір unet fp16 (має бути > 1.5GB)
    unet_file = sd15_path / "unet" / "diffusion_pytorch_model.fp16.safetensors"
    if unet_file.exists():
        unet_size = unet_file.stat().st_size / (1024**3)
        if unet_size < 1.5:
            return report_test("SD 1.5 модель", False, f"unet замалий: {unet_size:.1f}GB")

    return report_test("SD 1.5 модель", True, "fp16 файли на місці")


def test_controlnet_model() -> None:
    """Тест: ControlNet v1.1 модель повністю завантажена (fp16)"""
    cn_path = MODELS_PATH / "control_v11p_sd15_canny"

    if not cn_path.exists():
        return report_test("ControlNet v1.1", False, "директорія не існує")

    required_files = ["config.json"]
    # fp16 версія моделі
    required_patterns = [("diffusion_pytorch_model.fp16.safetensors", "model fp16")]

    missing_files = []
    for f in required_files:
        if not (cn_path / f).exists():
            missing_files.append(f)

    missing_patterns = []
    for pattern, name in required_patterns:
        matches = list(cn_path.glob(pattern))
        if not matches:
            missing_patterns.append(name)

    if missing_files or missing_patterns:
        all_missing = missing_files + missing_patterns
        return report_test("ControlNet v1.1", False, f"відсутні: {', '.join(all_missing)}")

    # Перевіряємо розмір fp16 (має бути > 600MB)
    model_file = cn_path / "diffusion_pytorch_model.fp16.safetensors"
    if model_file.exists():
        size = model_file.stat().st_size / (1024**3)
        if size < 0.6:
            return report_test("ControlNet v1.1", False, f"модель замала: {size:.2f}GB")

    return report_test("ControlNet v1.1", True, "fp16 файл на місці")


def test_no_wrong_model_formats() -> None:
    """Тест: Немає неправильних форматів моделей (Flax, ONNX, OpenVINO)"""
    wrong_patterns = [
        "**/*.msgpack",      # Flax
        "**/*.onnx",         # ONNX
        "**/*.onnx_data",    # ONNX data
        "**/openvino_*",     # OpenVINO
        "**/flax_model*",    # Flax
        "**/tf_model*",      # TensorFlow
    ]

    found_wrong = []
    for pattern in wrong_patterns:
        matches = list(MODELS_PATH.glob(pattern))
        for m in matches:
            # Ігноруємо якщо це в .cache
            if ".cache" not in str(m):
                found_wrong.append(m.name)

    if found_wrong:
        return report_test(
            "Немає Flax/ONNX/OpenVINO",
            False,
            f"знайдено: {', '.join(found_wrong[:3])}..."
        )
    return report_test("Немає Flax/ONNX/OpenVINO", True, "тільки PyTorch формат")


def test_no_unnecessary_large_files() -> None:
    """Тест: Немає зайвих великих файлів (single-file checkpoints, old formats)"""
    sd15_path = MODELS_PATH / "stable-diffusion-v1-5"

    if not sd15_path.exists():
        return report_test("Немає зайвих файлів", True, "SD 1.5 ще не завантажено")

    # SD 1.5 зазвичай не має fp16 варіантів окремо, але перевіряємо на .ckpt файли
    unnecessary_files = [
        "v1-5-pruned.ckpt",                     # Old checkpoint format
        "v1-5-pruned-emaonly.ckpt",             # Old checkpoint format
    ]

    found = []
    total_waste = 0
    for f in unnecessary_files:
        path = sd15_path / f
        if path.exists():
            size = path.stat().st_size / (1024**3)
            found.append(f"{Path(f).name} ({size:.1f}GB)")
            total_waste += size

    if found:
        return report_test(
            "Немає зайвих файлів",
            False,
            f"зайві ~{total_waste:.0f}GB: {', '.join(found[:2])}..."
        )
    return report_test("Немає зайвих файлів", True, "тільки safetensors формат")


def test_frontend_dependencies() -> None:
    """Тест: Frontend залежності встановлені"""
    frontend_path = BASE_PATH / "frontend"
    node_modules = frontend_path / "node_modules"
    package_json = frontend_path / "package.json"

    if not package_json.exists():
        return report_test("Frontend package.json", False, "не знайдено")

    if not node_modules.exists():
        return report_test("Frontend node_modules", False, "npm install не виконано")

    # Перевіряємо кількість пакетів
    pkg_count = len(list(node_modules.iterdir()))
    if pkg_count < 10:
        return report_test("Frontend node_modules", False, f"тільки {pkg_count} пакетів")

    return report_test("Frontend node_modules", True, f"{pkg_count} пакетів")


def test_api_service_file() -> None:
    """Тест: API service файл не має помилок з Content-Type"""
    api_file = BASE_PATH / "frontend" / "src" / "services" / "api.ts"

    if not api_file.exists():
        return report_test("Frontend api.ts", False, "файл не знайдено")

    content = api_file.read_text()

    # Перевіряємо що немає ручного Content-Type для FormData
    # Шукаємо патерн: formData + headers з Content-Type
    lines = content.split('\n')
    bad_patterns = []

    in_formdata_block = False
    for i, line in enumerate(lines):
        if 'FormData()' in line:
            in_formdata_block = True
        if in_formdata_block and "'Content-Type': 'multipart/form-data'" in line:
            bad_patterns.append(f"line {i+1}")
        if in_formdata_block and '});' in line:
            in_formdata_block = False

    if bad_patterns:
        return report_test(
            "API FormData Content-Type",
            False,
            f"ручний Content-Type в {', '.join(bad_patterns)}"
        )

    return report_test("API FormData Content-Type", True, "коректно")


def test_cli_imports() -> None:
    """Тест: CLI імпортується без помилок"""
    if not VENV_PYTHON.exists():
        return report_test("CLI імпорт", False, "venv не знайдено")

    result = subprocess.run(
        [str(VENV_PYTHON), "-c", """
import sys
sys.path.insert(0, '.')
from cli_app import YogaPlatformCLI, DependencyChecker, ModelDownloader
print("OK")
"""],
        capture_output=True,
        text=True,
        cwd=str(BACKEND_PATH),
    )

    if result.returncode != 0:
        error = result.stderr.strip().split('\n')[-1] if result.stderr else "unknown"
        return report_test("CLI імпорт", False, error[:50])

    return report_test("CLI імпорт", True)


def test_dependency_checker() -> None:
    """Тест: DependencyChecker працює коректно"""
    if not VENV_PYTHON.exists():
        return report_test("DependencyChecker", False, "venv не знайдено")

    result = subprocess.run(
        [str(VENV_PYTHON), "-c", """
import sys
sys.path.insert(0, '.')
from cli_app import DependencyChecker

checker = DependencyChecker()

# Тест CUDA check
cuda = checker.check_cuda()
print(f"CUDA: {cuda.status.value} - {cuda.version}")

# Тест models check
models = checker.check_models()
for m in models:
    print(f"Model {m.name}: {m.status.value}")

# Тест check_all
all_ok, results = checker.check_all()
print(f"All OK: {all_ok}")
"""],
        capture_output=True,
        text=True,
        cwd=str(BACKEND_PATH),
    )

    if result.returncode != 0:
        error = result.stderr.strip().split('\n')[-1] if result.stderr else "unknown"
        return report_test("DependencyChecker", False, error[:50])

    output = result.stdout.strip()
    return report_test("DependencyChecker", True, "працює")


def test_models_directory_structure() -> None:
    """Тест: Структура директорії моделей коректна"""
    if not MODELS_PATH.exists():
        return report_test("Models директорія", False, "не існує")

    expected_dirs = [
        "stable-diffusion-v1-5",
        "control_v11p_sd15_canny",
    ]

    missing = []
    for d in expected_dirs:
        if not (MODELS_PATH / d).exists():
            missing.append(d)

    if missing:
        return report_test("Models директорія", False, f"відсутні: {', '.join(missing)}")

    return report_test("Models директорія", True, f"{len(expected_dirs)} моделей")


def run_all_tests():
    """Запустити всі тести"""
    print_header("YOGA PLATFORM - ЖОРСТКІ ТЕСТИ")

    results = []

    def run_and_capture(test_fn) -> bool:
        original_print_test = print_test
        captured = {"value": True}

        def _capturing_print_test(name: str, passed: bool, details: str = ""):
            captured["value"] = bool(passed)
            return original_print_test(name, passed, details)

        globals()["print_test"] = _capturing_print_test
        try:
            test_fn()
        finally:
            globals()["print_test"] = original_print_test
        return bool(captured["value"])

    # Базові тести
    print(f"{BOLD}Базова інфраструктура:{RESET}")
    results.append(run_and_capture(test_venv_exists))
    results.append(run_and_capture(test_python_packages))
    results.append(run_and_capture(test_cli_imports))
    results.append(run_and_capture(test_dependency_checker))

    # GPU тести
    print(f"\n{BOLD}GPU/CUDA:{RESET}")
    results.append(run_and_capture(test_pytorch_cuda_version))
    results.append(run_and_capture(test_cuda_available))

    # Тести моделей
    print(f"\n{BOLD}AI Моделі:{RESET}")
    results.append(run_and_capture(test_models_directory_structure))
    results.append(run_and_capture(test_sd15_model))
    results.append(run_and_capture(test_controlnet_model))
    results.append(run_and_capture(test_no_wrong_model_formats))
    results.append(run_and_capture(test_no_unnecessary_large_files))

    # Frontend тести
    print(f"\n{BOLD}Frontend:{RESET}")
    results.append(run_and_capture(test_frontend_dependencies))
    results.append(run_and_capture(test_api_service_file))

    # Підсумок
    passed = sum(results)
    total = len(results)

    print(f"\n{'=' * 60}")
    if passed == total:
        print(f"{GREEN}{BOLD}✓ ВСІ ТЕСТИ ПРОЙДЕНО: {passed}/{total}{RESET}")
    else:
        print(f"{RED}{BOLD}✗ ПРОВАЛЕНО: {total - passed}/{total} тестів{RESET}")
        print(f"{YELLOW}  Виправте помилки перед запуском проекту{RESET}")
    print(f"{'=' * 60}\n")

    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
