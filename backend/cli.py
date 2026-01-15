#!/usr/bin/env python3
"""
Yoga Platform CLI - головна точка входу
"""

import os
import sys

# Додаємо поточну директорію до шляху
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def main():
    """Головна функція CLI"""
    from cli_app import YogaPlatformCLI

    app = YogaPlatformCLI()
    app.run()


if __name__ == "__main__":
    main()
