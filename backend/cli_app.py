#!/usr/bin/env python3
"""
Yoga Platform CLI Application - Fully Automatic.
No user interaction required - everything installs and starts automatically.
"""

import argparse
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path


class Colors:
    """ANSI colors for terminal"""

    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"


def info(msg):
    print(f"{Colors.BLUE}[INFO]{Colors.RESET} {msg}")


def success(msg):
    print(f"{Colors.GREEN}[OK]{Colors.RESET} {msg}")


def warn(msg):
    print(f"{Colors.YELLOW}[WARN]{Colors.RESET} {msg}")


def error(msg):
    print(f"{Colors.RED}[ERROR]{Colors.RESET} {msg}")


class YogaPlatform:
    """Fully automatic platform launcher"""

    def __init__(self):
        self.base_path = Path(__file__).parent.parent
        self.backend_path = Path(__file__).parent
        self.frontend_path = self.base_path / "frontend"
        self.venv_path = self.backend_path / "venv"
        self.venv_python = self.venv_path / "bin" / "python"
        self.venv_pip = self.venv_path / "bin" / "pip"

        self.frontend_process = None
        self.backend_process = None
        self._shutdown_requested = False

        self.required_python_packages = ["uvicorn", "fastapi"]

    def print_banner(self):
        """Print startup banner"""
        print(f"\n{Colors.CYAN}{Colors.BOLD}")
        print("=" * 60)
        print("          YOGA PLATFORM - AI Pose Generation")
        print("=" * 60)
        print(f"{Colors.RESET}\n")

    def setup_venv(self):
        """Create and setup virtual environment"""
        if not self.venv_path.exists():
            info("Creating virtual environment...")
            subprocess.run(
                [sys.executable, "-m", "venv", str(self.venv_path)],
                check=True,
                capture_output=True,
            )
            success("Virtual environment created")
        return True

    def _ensure_pip(self) -> bool:
        """Ensure pip is available in the virtual environment."""
        check = subprocess.run(
            [str(self.venv_python), "-m", "pip", "--version"],
            capture_output=True,
            text=True,
        )
        if check.returncode == 0:
            return True

        warn("pip not found in venv, installing with ensurepip...")
        ensure = subprocess.run(
            [str(self.venv_python), "-m", "ensurepip", "--upgrade"],
            capture_output=True,
            text=True,
        )
        if ensure.returncode != 0:
            error(f"Failed to bootstrap pip: {ensure.stderr}")
            return False

        upgrade = subprocess.run(
            [str(self.venv_python), "-m", "pip", "install", "--upgrade", "pip", "-q"],
            capture_output=True,
            text=True,
        )
        if upgrade.returncode != 0:
            error(f"Failed to upgrade pip: {upgrade.stderr}")
            return False

        return True

    def _verify_python_deps(self) -> bool:
        """Check for critical Python packages in venv."""
        missing_packages = []
        for package in self.required_python_packages:
            check = subprocess.run(
                [str(self.venv_python), "-m", "pip", "show", package],
                capture_output=True,
                text=True,
            )
            if check.returncode != 0:
                missing_packages.append(package)

        if missing_packages:
            warn(f"Missing Python packages: {', '.join(missing_packages)}")
            return False

        return True

    def install_python_deps(self):
        """Install Python dependencies automatically"""
        requirements = self.backend_path / "requirements.txt"
        marker = self.venv_path / ".deps_installed"

        # Check if already installed and requirements didn't change
        if marker.exists():
            if requirements.stat().st_mtime < marker.stat().st_mtime:
                if self._ensure_pip() and self._verify_python_deps():
                    success("Python dependencies up to date")
                    return True
                warn("Python dependencies incomplete, reinstalling...")

        info("Installing Python dependencies...")

        if not self._ensure_pip():
            return False

        # Upgrade pip silently
        subprocess.run(
            [str(self.venv_python), "-m", "pip", "install", "--upgrade", "pip", "-q"],
            capture_output=True,
        )

        # Install requirements
        result = subprocess.run(
            [
                str(self.venv_python),
                "-m",
                "pip",
                "install",
                "-r",
                str(requirements),
                "-q",
                "--disable-pip-version-check",
                "--no-input",
            ],
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            error(f"Failed to install dependencies: {result.stderr}")
            return False

        if not self._verify_python_deps():
            missing_packages = [
                pkg
                for pkg in self.required_python_packages
                if subprocess.run(
                    [str(self.venv_python), "-m", "pip", "show", pkg],
                    capture_output=True,
                    text=True,
                ).returncode
                != 0
            ]

            if missing_packages:
                extra_install = subprocess.run(
                    [
                        str(self.venv_python),
                        "-m",
                        "pip",
                        "install",
                        *missing_packages,
                        "-q",
                        "--disable-pip-version-check",
                        "--no-input",
                    ],
                    capture_output=True,
                    text=True,
                )
                if extra_install.returncode != 0:
                    error(f"Failed to install dependencies: {extra_install.stderr}")
                    return False

                if not self._verify_python_deps():
                    error("Python dependencies still missing after install")
                    return False

        marker.touch()
        success("Python dependencies installed")
        return True

    def install_node_deps(self):
        """Install Node.js dependencies automatically"""
        node_modules = self.frontend_path / "node_modules"

        if node_modules.exists():
            success("Node.js dependencies up to date")
            return True

        info("Installing Node.js dependencies...")

        result = subprocess.run(
            [
                "npm",
                "install",
                "--silent",
                "--no-audit",
                "--no-fund",
                "--legacy-peer-deps",
            ],
            cwd=self.frontend_path,
            capture_output=True,
            text=True,
            env={**os.environ, "CI": "true", "npm_config_yes": "true"},
        )

        if result.returncode == 0:
            success("Node.js dependencies installed")
            return True
        else:
            # Try with force
            result = subprocess.run(
                ["npm", "install", "--force", "--silent"],
                cwd=self.frontend_path,
                capture_output=True,
            )
            if result.returncode == 0:
                success("Node.js dependencies installed")
                return True
            error("Failed to install Node.js dependencies")
            return False

    def ensure_env_file(self):
        """Ensure .env file exists with API key"""
        env_file = self.backend_path / ".env"

        if env_file.exists():
            success("Configuration file found")
            return True

        info("Creating configuration file...")

        env_content = """# Yoga Platform Configuration (Auto-generated)
APP_MODE=dev
DATABASE_URL=sqlite+aiosqlite:///./yoga_platform.db
SECRET_KEY=auto-generated-secret-key-change-in-production
GOOGLE_API_KEY=AIzaSyDW6KcAYNGLiz1UpzPWDDl9TPsJw4U-2ew
USE_GOOGLE_AI=true
"""
        env_file.write_text(env_content)
        success("Configuration file created")
        return True

    def ensure_storage_dirs(self):
        """Create storage directories"""
        dirs = [
            self.base_path / "storage" / "uploads",
            self.base_path / "storage" / "generated",
            self.base_path / "storage" / "layers",
        ]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)
        success("Storage directories ready")
        return True

    def setup_all(self):
        """Run all setup steps automatically"""
        steps = [
            ("Virtual environment", self.setup_venv),
            ("Python dependencies", self.install_python_deps),
            ("Node.js dependencies", self.install_node_deps),
            ("Configuration", self.ensure_env_file),
            ("Storage directories", self.ensure_storage_dirs),
        ]

        for name, func in steps:
            try:
                if not func():
                    error(f"Setup failed at: {name}")
                    return False
            except Exception as e:
                error(f"Setup failed at {name}: {e}")
                return False

        return True

    def _stream_output(self, process, prefix, color):
        """Stream process output"""
        if process.stdout:
            for line in iter(process.stdout.readline, b""):
                if self._shutdown_requested:
                    break
                try:
                    decoded = line.decode("utf-8", errors="replace").rstrip()
                    if decoded:
                        print(f"{color}[{prefix}]{Colors.RESET} {decoded}")
                except Exception:
                    pass

    def _shutdown(self, signum=None, frame=None):
        """Graceful shutdown"""
        if self._shutdown_requested:
            return
        self._shutdown_requested = True

        print(f"\n{Colors.YELLOW}Stopping servers...{Colors.RESET}")

        for name, proc in [
            ("Frontend", self.frontend_process),
            ("Backend", self.backend_process),
        ]:
            if proc:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
                success(f"{name} stopped")

        print(f"\n{Colors.CYAN}Goodbye!{Colors.RESET}\n")
        sys.exit(0)

    def start_dev(self):
        """Start both frontend and backend in dev mode"""
        self.print_banner()

        info("Setting up environment...\n")

        if not self.setup_all():
            error("Setup failed!")
            sys.exit(1)

        print(f"\n{Colors.GREEN}{Colors.BOLD}Starting servers...{Colors.RESET}\n")

        # Setup shutdown handlers
        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

        # Start frontend
        info("Frontend: http://localhost:3000")
        self.frontend_process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=self.frontend_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env={**os.environ, "FORCE_COLOR": "1"},
        )

        frontend_thread = threading.Thread(
            target=self._stream_output,
            args=(self.frontend_process, "FRONTEND", Colors.CYAN),
            daemon=True,
        )
        frontend_thread.start()

        # Start backend
        info("Backend:  http://localhost:8000")
        info("API Docs: http://localhost:8000/docs")
        print(f"\n{Colors.DIM}Press Ctrl+C to stop{Colors.RESET}\n")
        print(f"{Colors.DIM}{'-' * 60}{Colors.RESET}\n")

        self.backend_process = subprocess.Popen(
            [
                str(self.venv_python),
                "-m",
                "uvicorn",
                "main:app",
                "--reload",
                "--port",
                "8000",
            ],
            cwd=self.backend_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env={**os.environ, "FORCE_COLOR": "1"},
        )

        # Stream backend in main thread
        self._stream_output(self.backend_process, "BACKEND", Colors.GREEN)
        self._shutdown()

    def start_backend(self):
        """Start only backend"""
        self.print_banner()

        if not self.setup_all():
            sys.exit(1)

        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

        print(f"\n{Colors.GREEN}{Colors.BOLD}Starting Backend...{Colors.RESET}\n")
        info("Backend: http://localhost:8000")
        info("API Docs: http://localhost:8000/docs")
        print(f"\n{Colors.DIM}Press Ctrl+C to stop{Colors.RESET}\n")

        self.backend_process = subprocess.Popen(
            [
                str(self.venv_python),
                "-m",
                "uvicorn",
                "main:app",
                "--reload",
                "--port",
                "8000",
            ],
            cwd=self.backend_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        self._stream_output(self.backend_process, "BACKEND", Colors.GREEN)
        self._shutdown()

    def start_frontend(self):
        """Start only frontend"""
        self.print_banner()

        if not self.install_node_deps():
            sys.exit(1)

        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

        print(f"\n{Colors.GREEN}{Colors.BOLD}Starting Frontend...{Colors.RESET}\n")
        info("Frontend: http://localhost:3000")
        print(f"\n{Colors.DIM}Press Ctrl+C to stop{Colors.RESET}\n")

        self.frontend_process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=self.frontend_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        self._stream_output(self.frontend_process, "FRONTEND", Colors.CYAN)
        self._shutdown()

    def run(self):
        """Main entry point - auto-start dev mode by default"""
        parser = argparse.ArgumentParser(
            prog="yoga-platform", description="Yoga Platform - Fully Automatic Launcher"
        )
        parser.add_argument("--backend", action="store_true", help="Start backend only")
        parser.add_argument(
            "--frontend", action="store_true", help="Start frontend only"
        )
        parser.add_argument("--dev", action="store_true", help="Start both (default)")

        args = parser.parse_args()

        if args.backend:
            self.start_backend()
        elif args.frontend:
            self.start_frontend()
        else:
            # Default: start both frontend and backend
            self.start_dev()


# Alias for backward compatibility
YogaPlatformCLI = YogaPlatform

if __name__ == "__main__":
    app = YogaPlatform()
    app.run()
