#!/usr/bin/env python3
"""Install project-local, pinned build dependencies. Never changes shell profiles."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
LVGL_COMMIT = '85aa60d18b3d5e5588d7b247abf90198f07c8a63'
EMSDK_VERSION = '4.0.23'

def run(*args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wasm', action='store_true')
    args = parser.parse_args()
    deps = ROOT / '.deps'
    deps.mkdir(exist_ok=True)
    lvgl = deps / 'lvgl'
    if not lvgl.exists():
        run('git', 'clone', '--depth', '1', '--branch', 'v9.5.0', 'https://github.com/lvgl/lvgl.git', lvgl)
    revision = lvgl / 'LVGLPLUS_REVISION'
    actual = revision.read_text().strip() if revision.exists() else subprocess.check_output(['git', '-C', str(lvgl), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != LVGL_COMMIT:
        raise SystemExit(f'Unexpected LVGL commit {actual}; expected {LVGL_COMMIT}. Set up the pinned checkout explicitly.')
    venv = ROOT / '.venv'
    if not venv.exists():
        run(sys.executable, '-m', 'venv', venv)
    python = venv / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    run(python, '-m', 'pip', 'install', '-r', ROOT / 'requirements-build.txt')
    if args.wasm:
        emsdk = deps / 'emsdk'
        if not emsdk.exists():
            run('git', 'clone', '--depth', '1', '--branch', EMSDK_VERSION, 'https://github.com/emscripten-core/emsdk.git', emsdk)
        run(sys.executable, emsdk / 'emsdk.py', 'install', EMSDK_VERSION)
        run(sys.executable, emsdk / 'emsdk.py', 'activate', EMSDK_VERSION)
    print('Dependencies ready. Next: pnpm build && pnpm generate && pnpm build:wasm')

if __name__ == '__main__':
    main()
