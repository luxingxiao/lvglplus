import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadProject,
  generateProject,
  repositoryRoot,
} from "../packages/cli/dist/project.js";
import { buildNative, render } from "../packages/cli/dist/build.js";
import {
  compile,
  encodePackage,
  flatten,
} from "../packages/compiler/dist/index.js";

const project = await loadProject(
  path.join(repositoryRoot, "examples/vehicle"),
);
await generateProject(project);
const bytes = encodePackage(project.ir),
  create = (
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
const wrap = (n, r, a = []) => wasm.cwrap("lvp_preview_" + n, r, a);
const load = wrap("load", "number", ["number", "number"]),
  tick = wrap("tick", null, ["number"]),
  set = wrap("set", "number", ["number", "number", "number", "number"]),
  get = wrap("number", "number", ["number"]),
  q = wrap("quality", "number", ["number"]),
  pixel = wrap("pixels", "number"),
  bounds = wrap("bounds", "number", ["number", "number"]);
function loadBytes(data) {
  const p = wasm._malloc(data.length);
  wasm.HEAPU8.set(data, p);
  const result = load(p, data.length);
  wasm._free(p);
  return result;
}
assert.equal(loadBytes(bytes), 0);
const values = { "vehicle.speed": 120, "battery.soc": 50 };
for (const [name, value] of Object.entries(values))
  assert.equal(
    set(
      project.ir.signals.findIndex((s) => s.name === name),
      value,
      100,
      0,
    ),
    0,
  );
tick(100);
const pngDir = path.join(repositoryRoot, "build/parity");
await mkdir(pngDir, { recursive: true });
const binary = await buildNative(project),
  native = await render(project, {
    binary,
    output: path.join(pngDir, "interpreted.png"),
    atMs: 100,
    values,
  });
for (let i = 0; i < project.ir.signals.length; i++) {
  assert(
    Math.abs(get(i) - Number(native.values[project.ir.signals[i].name].value)) <
      1e-7,
    project.ir.signals[i].name,
  );
  assert.equal(
    q(i),
    ["valid", "stale", "invalid", "disconnected"].indexOf(
      native.values[project.ir.signals[i].name].quality,
    ),
  );
}
const ptr = pixel(),
  frame = wasm.HEAPU8.slice(ptr, ptr + 800 * 480 * 4),
  ppm = await readFile(path.join(project.root, ".lvglplus/results/frame.ppm"));
const header = Buffer.from("P6\n800 480\n255\n");
let maxDiff = 0,
  changed = 0;
for (let i = 0; i < 800 * 480; i++)
  for (let c = 0; c < 3; c++) {
    const diff = Math.abs(
      frame[i * 4 + 2 - c] - ppm[header.length + i * 3 + c],
    );
    maxDiff = Math.max(maxDiff, diff);
    if (diff) changed++;
  }
assert.equal(
  changed,
  0,
  `WASM/native framebuffer differs: ${changed} channels, maximum ${maxDiff}`,
);
const generatedBinary = await buildNative(project, true),
  generated = await render(project, {
    binary: generatedBinary,
    generated: true,
    output: path.join(pngDir, "generated.png"),
    atMs: 100,
    values,
  });
assert.deepEqual(native.png, generated.png);
assert.equal(native.tree, generated.tree);
assert.deepEqual(native.values, generated.values);
for (const [i, n] of flatten(project.ir).entries()) {
  const p = wasm._malloc(16);
  assert.equal(bounds(i, p), 0);
  const actual = Array.from(wasm.HEAP32.subarray(p / 4, p / 4 + 4));
  wasm._free(p);
  const line = native.tree.trim().split("\n")[i].split("\t");
  assert.deepEqual(actual, line.slice(2).map(Number), n.id);
}
// Exercise actual LVGL input routing, navigation, commands and two-way bindings.
const pointer = wrap("pointer", null, ["number", "number", "number"]);
let inputTime = 120;
function click(x, y) {
  pointer(x, y, 1);
  tick((inputTime += 40));
  pointer(x, y, 0);
  tick((inputTime += 40));
}
function rect(id) {
  const index = flatten(project.ir).findIndex((n) => n.id === id),
    p = wasm._malloc(16);
  assert.equal(bounds(index, p), 0);
  const r = Array.from(wasm.HEAP32.subarray(p / 4, p / 4 + 4));
  wasm._free(p);
  return r;
}
click(650, 400);
assert.equal(
  get(project.ir.signals.findIndex((s) => s.name === "vehicle.trip")),
  0,
);
click(500, 400);
const slider = rect("brightness");
click(slider[0] + slider[2] * 0.9, slider[1] + slider[3] / 2);
assert(
  get(project.ir.signals.findIndex((s) => s.name === "settings.brightness")) >
    80,
);
const toggle = rect("sport");
click(toggle[0] + toggle[2] / 2, toggle[1] + toggle[3] / 2);
assert.equal(
  get(project.ir.signals.findIndex((s) => s.name === "settings.sport")),
  1,
);
const back = rect("back");
click(back[0] + 10, back[1] + 10);
// Hot reload retains compatible model data and rejects a broken package transactionally.
assert.equal(loadBytes(bytes), 0);
assert.equal(get(0), 120);
assert.equal(loadBytes(bytes.subarray(0, 50)), -1);
assert.equal(get(0), 120);
// Shared expression VM must short-circuit inactive divide-by-zero branches.
const alternate = compile({
  manifest: project.manifest,
  ui: project.ui,
  model: project.model.replace(
    "vehicle.speed * 0.621371",
    "vehicle.speed == 0 ? 0 : 100 / vehicle.speed",
  ),
});
assert(alternate.ir);
assert.equal(loadBytes(encodePackage(alternate.ir)), 0);
assert.equal(set(0, 0, 100, 0), 0);
tick(100);
const derivedIndex = alternate.ir.signals.findIndex(
  (s) => s.name === "vm.speedMph",
);
assert.equal(get(derivedIndex), 0);
assert.equal(q(derivedIndex), 0);
// Verify quality propagation and page lifetime across many rebuilds.
for (let i = 0; i < 20; i++) assert.equal(loadBytes(bytes), 0);
tick(2000);
assert.equal(q(0), 1);
wrap("close", null)();
console.log(
  JSON.stringify(
    {
      passed: true,
      signals: project.ir.signals.length,
      nodes: flatten(project.ir).length,
      framebuffer: "native = WASM = generated C (exact)",
      hotReloads: 20,
      lazyExpression: true,
      output: pngDir,
    },
    null,
    2,
  ),
);
