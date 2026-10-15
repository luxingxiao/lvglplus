// SPDX-License-Identifier: Apache-2.0
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { loadProject, repositoryRoot } from "../packages/cli/dist/project.js";
import {
  compile,
  encodePackage,
  flatten,
} from "../packages/compiler/dist/index.js";
const project = await loadProject(
  path.join(repositoryRoot, "examples/vehicle"),
);
const start = performance.now();
const create = (
  await import(
    pathToFileURL(
      path.join(repositoryRoot, "packages/studio/public/runtime/lvp.js"),
    ).href
  )
).default;
const wasm = await create({
  wasmBinary: new Uint8Array(
    await readFile(
      path.join(repositoryRoot, "packages/studio/public/runtime/lvp.wasm"),
    ),
  ),
});
const initialized = performance.now();
const call = (name, ret, args = []) =>
  wasm.cwrap("lvp_preview_" + name, ret, args);
const load = call("load", "number", ["number", "number"]),
  tick = call("tick", null, ["number"]),
  set = call("set", "number", ["number", "number", "number", "number"]);
function reload() {
  const result = compile({
    manifest: project.manifest,
    ui: project.ui,
    model: project.model,
  });
  if (!result.ir) throw new Error("Compile failed");
  const bytes = encodePackage(result.ir),
    ptr = wasm._malloc(bytes.length);
  wasm.HEAPU8.set(bytes, ptr);
  const resultCode = load(ptr, bytes.length);
  wasm._free(ptr);
  if (resultCode !== 0) throw new Error("Package failed");
  tick(0);
}
reload();
const first = performance.now();
const samples = [];
for (let i = 0; i < 30; i++) {
  const before = performance.now();
  reload();
  samples.push(performance.now() - before);
}
samples.sort((a, b) => a - b);
const beforeFrames = performance.now();
for (let i = 0; i < 240; i++) {
  set(0, i % 160, i * 16, 0);
  tick(i * 16);
}
const frameMs = performance.now() - beforeFrames;
console.log(
  JSON.stringify(
    {
      fixture:
        "vehicle 800x480; 18 signals; " + flatten(project.ir).length + " nodes",
      host: {
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
        node: process.version,
      },
      wasmInitializeMs: +(initialized - start).toFixed(2),
      firstCompileAndRenderMs: +(first - initialized).toFixed(2),
      xmlReloadMedianMs: +samples[15].toFixed(2),
      xmlReloadP95Ms: +samples[28].toFixed(2),
      softwareRenderFrames: 240,
      softwareRenderTotalMs: +frameMs.toFixed(2),
      wasmReservedLinearMemoryBytes: wasm.HEAPU8.byteLength,
      limitations:
        "Node-hosted WASM; no browser canvas upload, hardware display, GPU or device FPS measurement",
    },
    null,
    2,
  ),
);
call("close", null)();
