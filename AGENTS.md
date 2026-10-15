# LVGL Plus contributor instructions

- Preserve `docs/lvglpro` as historical research. Implementation and specification changes belong in `docs/lvglplus`.
- Maintain an independently authored XML language and implementation. Never copy Pro widget XML metadata or restricted schemas.
- Public device APIs use `lvp_` and keep the core C99/LVGL-free. Rendering belongs in the adapter; protocols never hold LVGL object pointers.
- Keep generated output in dedicated ignored directories and user application code outside them.
- Run `pnpm test` and `pnpm test:c` after behavioral changes. Shared renderer/compiler changes also need `pnpm build:wasm` then `pnpm test:render`. DBC changes need `pnpm test:dbc`.
- Report native, WASM, cross-compiled and real-hardware verification separately. Mark unimplemented stages honestly in the capability matrix.
