# Changelog

## 0.2.0

- Shared-C deterministic animation, translations, registered fonts and custom widget factories.
- Studio visual node creation/movement/resize/reparenting, XML undo/redo, binding/event/animation/component/slot tools, PNG management and resource budgets.
- Independent Figma export/import with ownership hashes; self-hosted static LVGL Viewer.
- TCP/UDP/serial JSON, MQTT QoS 0, read-only Modbus TCP, source recording and quality-aware replay.
- Versioned/checksummed dynamic UI bundles, transactional C view replacement and host A/B staging/rollback.
- Local MCP tools using the shared WASM model/renderer; Plus draft manifest migration.
- Linux DRM/evdev + SocketCAN integration template, Cortex-M4 BSP entrypoint and Electron application wrapper.

Public XML/project v1; IR/package v2; C SDK and bundle ABI v1; LVGL 9.5.0.

Platform acceptance is separate from implementation: see `docs/lvglplus/verification.md` and `roadmap.md`. Electron download, real Figma host, DRM hardware and MCU board acceptance are not claimed by this change.
