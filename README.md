# LVGL Plus

**English** | [简体中文](README.zh-CN.md)

**AI-friendly instrument development. One model, from simulation to production.**

LVGL Plus is an Apache 2.0 open-source toolchain for instrument UIs. Describe interfaces and data models in independently designed XML, debug them with real LVGL in a browser, and switch from simulated data to CAN/DBC or recorded playback without rewriting pages. Production applications compile generated C definitions with a small C99 SDK.

LVGL Pro's product workflow informed the research. Plus has its own language and implementation: it does not import Pro projects or depend on Pro software, licensing, or its XML engine.

## Quick start

Prerequisites: Node.js 24, pnpm 11.7, Python 3, CMake 3.20+, Git, and a C/C++ compiler. Build dependencies are installed in the project's `.deps/` and `.venv/` directories.

```sh
git clone https://github.com/luxingxiao/lvglplus.git
cd lvglplus
pnpm install
python3 scripts/bootstrap.py --wasm
pnpm build:wasm
pnpm build
pnpm dev
```

Open the URL printed by the command, normally `http://127.0.0.1:5178`. Studio provides local XML editing, real LVGL/WASM preview, an object tree, an Inspector, target selection, model injection, and simulated or recorded data sources. Press `⌘/Ctrl+S` to save and rebuild the preview; syntax errors preserve the last valid view.

Select **REPLAY** to pause, change speed, or seek through a driving recording. Select **MANUAL**, enter a signal value, and press Enter to inject it. Click SETTINGS on the device display to try slider/switch two-way binding. Diagnostic commands report failure when no device handler exists; they do not simulate successful device responses.

## Complex instruments without custom C widgets

General-purpose graphics, dynamic geometry bindings, bounded collections, shared mathematical and spatial operations, atomic actions, state machines, clocks, snapshots, and declarative fonts are available. See the [declarative capability specification](docs/lvglplus/declarative.md) for semantics and limits.

```sh
pnpm test:declarative
```

Public rendering tests use the independently authored geometry fixture in `tests/fixtures/graphics`. Application-specific validation sources are kept locally outside version control and are not distributed. Generated artifacts use IR v4 / SDK ABI 3; rebuild the SDK when updating.

## Capabilities (0.2.0)

- XML → type checking → public IR → WASM preview packages / production C definitions and CMake files.
- Pages, composed components, parameters, slots, shared styles, Flex layouts, eight basic widget types, and targets with different resolutions.
- C99 typed models, a shared expression VM, one-way/two-way bindings, command status, batched updates, and lifecycle cleanup.
- Signal timestamps, units, quality, timeouts, disconnections, and bounded input queues with overflow counters.
- Simulation, deterministic replay, Linux SocketCAN/CAN FD, and build-time cantools DBC-to-C codec generation.
- A real LVGL headless native runner, PNG screenshots, model assertions, explicit visual baselines, and interpreter/generated-C consistency checks.
- A local Web Studio with no account or paid service requirement; project-supplied build scripts are not executed.

Version 0.2.0 also includes Studio drag/resize/reorder with undo/redo, visual binding/event/animation editing, translations, fonts, custom C widgets, resource management and budgets, a static Viewer, independent Figma import/export, dynamic UI packages with A/B rollback, network/serial/MQTT/Modbus plugins, recording, MCP, migrations, and desktop packaging source. See the [P3–P5 guide](docs/lvglplus/p3-p5.md).

Implementation and platform acceptance are tracked separately. Toolchain and core CI pass on Linux, macOS, and Windows; Linux vcan/CAN FD software integration and the DRM target build also pass. Electron distribution, the Figma host, physical DRM displays, real CAN transceivers, and MCU hardware still require acceptance testing. Cross-compilation does not establish board support. See the [latest verification evidence](docs/lvglplus/verification-declarative.md) and [capability matrix](docs/lvglplus/roadmap.md).

## Examples

| Example | Purpose |
| --- | --- |
| [Energy console](examples/energy-console/README.md) | Complex microgrid dashboard: smooth annular gradients, rotating turbine, dynamic curves, clipping, render profiles, seven-scenario native/generated-C/WASM verification; no custom C widgets |
| [Vehicle](examples/vehicle/plus.project.json) | Instrument UI with simulation, replay and CAN/DBC integration |
| [Custom widget](examples/custom/plus.project.json) | Optional C widget extension and translations |

```sh
node packages/cli/dist/main.js dev examples/energy-console --port 5181
pnpm test:energy
```

## CLI

In the source workspace, use `node packages/cli/dist/main.js`. Installed distribution packages expose the command as `lvglplus`.

```sh
node packages/cli/dist/main.js doctor --json
node packages/cli/dist/main.js init my-cluster
node packages/cli/dist/main.js validate examples/vehicle --json
node packages/cli/dist/main.js generate examples/vehicle
node packages/cli/dist/main.js build examples/vehicle
node packages/cli/dist/main.js screenshot examples/vehicle --out build/cluster.png
node packages/cli/dist/main.js test examples/vehicle --json
```

`generate` replaces the dedicated `.lvglplus/generated/` directory as a whole. **Keep user application code outside this directory.** Pass `--generated` to link static generated C into the runner; the default mode loads an independent binary UI package. Both modes share the rendering adapter and MVVM core. The production C path requires no XML/package parser, Node.js, or browser.

```sh
node packages/cli/dist/main.js viewer examples/vehicle --out build/review
node packages/cli/dist/main.js budget examples/vehicle --json
node packages/cli/dist/main.js bundle examples/vehicle --out build/bundle
node packages/cli/dist/main.js mcp examples/vehicle
node packages/cli/dist/main.js build examples/custom --wasm
```

Design mode supports adding, moving, resizing, and binding widgets; the resource panel manages PNG files. XML remains the source for translations and animations. See `examples/custom` for custom widgets, `tools/figma` for Figma integration, and `examples/protocols` for protocol configuration. Host the static Viewer with an ordinary HTTP server.

## Data and embedded integration

```text
Transport → Codec → Mapping → Model → ViewModel → Binding → LVGL
                                         ↑ Commands ↓
```

For live Linux data, configure `can0` or `vcan0`, run `lvglplus build <project> --gateway`, and select CAN / FD in Studio. The example gateway only receives data; it does not transmit vehicle control frames. SocketCAN is a Linux-specific local driver. On macOS and Windows, use simulation, replay, or a separately configured network bridge to a Linux gateway.

Start device integration with the [C SDK and porting guide](docs/lvglplus/embedding.md). `lvp_ui_attach()` attaches a generated UI to an LVGL display already initialized by the device. The BSP supplies scheduling and display/touch drivers. Compatibility records distinguish successful compilation, simulation, and real-device verification.

## Verification

```sh
pnpm test                         # Compiler, replay, service boundaries, save failures
pnpm test:c                       # C model, VM, queue, commands, CAN core
node tests/render-parity.mjs       # Requires LVGL/WASM: native, WASM, generated-C parity
```

The Linux kernel-backed vcan integration test is `tests/test_socketcan.py`. It is separate from portable CAN unit tests and does not substitute mocks for kernel interface verification. See the [verification records](docs/lvglplus/verification.md) for results and limits, and the [declarative verification record](docs/lvglplus/verification-declarative.md) for graphics consistency tests and cross-platform CI evidence.

## Documentation and license

The detailed technical documents currently use Simplified Chinese.

| Document | Contents |
| --- | --- |
| [Architecture](docs/lvglplus/architecture.md) | Data flow, module responsibilities, technical decisions |
| [Declarative capabilities](docs/lvglplus/declarative.md) | Graphics, collections, actions, state machines, clocks, fonts |
| [Language and IR](docs/lvglplus/language.md) | Project format, XML, bytecode, binary packages |
| [Data integration](docs/lvglplus/data.md) | Simulation, replay, DBC, SocketCAN |
| [Embedded porting](docs/lvglplus/embedding.md) | C APIs, threading, lifecycle contracts |
| [P3–P5 guide](docs/lvglplus/p3-p5.md) | Design tools, animation, plugins, packages, MCP, distribution |
| [Capabilities and roadmap](docs/lvglplus/roadmap.md) | Actual P0–P5 status and boundaries |
| [Verification evidence](docs/lvglplus/verification-declarative.md) | Native, WASM, cross-platform CI, cross-compilation |
| [LVGL Pro research](docs/lvglpro/README.md) | Historical research, not a Plus compatibility specification |

Project-authored code is licensed under the [Apache License 2.0](LICENSE). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Contributions to features, tests, and device ports are welcome through the [contribution guide](CONTRIBUTING.md).
