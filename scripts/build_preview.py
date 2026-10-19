#!/usr/bin/env python3
"""Build the shared C renderer and MVVM core for WebAssembly."""
import os
import sys
import argparse
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--project', type=Path)
args = parser.parse_args()
custom = []
fonts = []
project = args.project.resolve() if args.project else None
if project:
    fonts = json.loads(subprocess.check_output(['node',str(ROOT/'scripts/prepare_fonts.mjs'),str(project)],text=True))
    manifest = json.loads((project / 'plus.project.json').read_text())
    for name in manifest.get('native', {}).get('sources', []):
        file = (project / name).resolve()
        if not file.is_relative_to(project) or file.suffix not in ['.c', '.cc', '.cpp'] or ';' in str(file):
            raise SystemExit('Invalid custom source path')
        custom.append(str(file))
build = project / '.lvglplus/wasm' if project else ROOT / 'build/wasm'
sdk = ROOT / '.deps/emsdk'
env = dict(os.environ)
env['EMSDK_PYTHON'] = sys.executable
env['PATH'] = str(Path(sys.executable).parent) + os.pathsep + env.get('PATH', '')
env['EM_CONFIG'] = str(sdk / '.emscripten')
emcmake = sdk / 'upstream/emscripten/emcmake.py'
if not emcmake.exists():
    raise SystemExit('Missing Emscripten. Run python3 scripts/bootstrap.py --wasm')
subprocess.run([sys.executable, str(emcmake), 'cmake', '-S', str(ROOT), '-B', str(build),
                '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_TESTING=OFF', '-DLVP_CUSTOM_SOURCES=' + ';'.join(custom), '-DLVP_FONT_SOURCES=' + ';'.join(fonts)], env=env, check=True)
subprocess.run(['cmake', '--build', str(build), '--target', 'lvp_preview', '-j', '8'], env=env, check=True)
dest = project / '.lvglplus/runtime' if project else ROOT / 'packages/studio/public/runtime'
dest.mkdir(parents=True, exist_ok=True)
for name in ['lvp.js', 'lvp.wasm']:
    shutil.copy2(build / name, dest / name)
if not project:
    built = ROOT / 'packages/studio/dist/runtime'
    if built.parent.exists():
        built.mkdir(exist_ok=True)
        for name in ['lvp.js', 'lvp.wasm']:
            shutil.copy2(dest / name, built / name)
print(f'Built real LVGL WebAssembly preview in {dest}')
