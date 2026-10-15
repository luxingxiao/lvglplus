# Third-party notices

LVGL Plus source is Apache-2.0. Dependencies are not relicensed by this repository.

| Dependency | License | Use |
| --- | --- | --- |
| [LVGL 9.5.0](https://github.com/lvgl/lvgl/tree/v9.5.0) | MIT; bundled libraries have their own notices | C rendering foundation, pinned commit in bootstrap |
| [Emscripten](https://github.com/emscripten-core/emscripten) | MIT / University of Illinois-NCSA | Optional build tool, project-local SDK |
| [cantools](https://github.com/cantools/cantools) | MIT | Build-time DBC compiler; generated codec retains its MIT notice |
| [React](https://github.com/facebook/react) | MIT | Studio |
| [Vite](https://github.com/vitejs/vite) | MIT | Studio build tool |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | MIT | Local XML editor and worker |
| [saxes](https://github.com/lddubeau/saxes) | ISC | XML parsing |
| [ws](https://github.com/websockets/ws) | MIT | Local preview stream |
| [lv_font_conv](https://github.com/lvgl/lv_font_conv) | MIT | Build-time font generation |
| [Electron](https://github.com/electron/electron) | MIT plus bundled Chromium/Node notices | Optional desktop application shell |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Build tool |

The pnpm lockfile and `requirements-build.txt` pin package resolution. Python transitive dependencies and npm transitive packages retain the licenses distributed in their packages. Bootstrap preserves the complete LVGL checkout and its library notices in `.deps/lvgl`; shipping a product with optional libraries requires retaining the notices for those selected libraries too.

Release packaging must include LICENSE, NOTICE, this file, and applicable dependency notices. No LVGL Pro proprietary code, XML schema files, marketing assets, fonts or bundled examples are incorporated in the implementation. The project-authored vehicle DBC is a demonstration fixture.
