# Contributing

Use Node.js 24, the pinned pnpm workspace, and the documented C toolchains. Run `pnpm check`; changes to the shared renderer/compiler also require `node tests/render-parity.mjs` after building WASM. Add a regression test for behavioral changes.

Contributions must be independently authored or come from a compatible, documented license. Do not copy LVGL Pro XML specifications, editor code, widget metadata or examples into the implementation. Public LVGL Open APIs and properly attributed MIT dependencies are the supported foundation.

Generated output belongs in ignored build directories. Keep user code separate from generated files. Public C APIs use `lvp_`; changes to XML/IR/package compatibility require a version decision and migration notes. Do not claim hardware compatibility on the basis of cross-compilation alone.

For a board port, provide board/display/RTOS/toolchain versions, configuration, reproducible commands, memory/performance measurements, and the verification level. For protocols, include known-answer byte fixtures and malformed-input tests.

Open an issue before large language or SDK changes. Pull requests should describe the observable behavior, validation performed, and limitations. Documentation may be Chinese or English; public identifiers and code comments should remain concise and consistent.
