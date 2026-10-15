#!/usr/bin/env python3
"""Build the shared C renderer and MVVM core for WebAssembly."""
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
sdk = ROOT / '.deps/emsdk'
env = dict(os.environ)
env['EM_CONFIG'] = str(sdk / '.emscripten')
emcmake = sdk / 'upstream/emscripten/emcmake.py'
if not emcmake.exists():
    raise SystemExit('Missing Emscripten. Run python3 scripts/bootstrap.py --wasm')
subprocess.run(['python3', str(emcmake), 'cmake', '-S', str(ROOT), '-B', str(ROOT / 'build/wasm'),
                '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=OFF'], env=env, check=True)
subprocess.run(['cmake', '--build', str(ROOT / 'build/wasm'), '--target', 'lvp_preview', '-j', '8'], env=env, check=True)
dest = ROOT / 'packages/studio/public/runtime'
dest.mkdir(parents=True, exist_ok=True)
for name in ['lvp.js', 'lvp.wasm']:
    shutil.copy2(ROOT / 'build/wasm' / name, dest / name)
print(f'Built real LVGL WebAssembly preview in {dest}')
