import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  loadProject,
  generateProject,
  repositoryRoot,
} from "../packages/cli/dist/project.js";
import { buildNative, run } from "../packages/cli/dist/build.js";
import { projectAssets } from "../packages/cli/dist/artifacts.js";
import { encodePackage } from "../packages/compiler/dist/index.js";
const project = await loadProject(
  path.join(repositoryRoot, "tests/fixtures/media"),
);
const out = path.join(project.root, ".lvglplus/parity");
await mkdir(out, { recursive: true });
await generateProject(project);
const native = await buildNative(project),
  generated = await buildNative(project, true);
const create = (
  await import(
    pathToFileURL(
      path.join(repositoryRoot, "packages/studio/public/runtime/lvp.js"),
    )
  )
).default;
const scenarios = [
  {
    name: "selection-quality",
    steps: [
      ["tick", 0],
      ["command", "green"],
      ["command", "bad"],
      ["tick", 75],
    ],
    selected: [0, 255, 0],
    sequence: [0, 255, 0],
  },
  {
    name: "paused-sequence",
    steps: [
      ["tick", 0],
      ["tick", 50],
      ["command", "pause"],
      ["tick", 500],
    ],
    selected: [255, 0, 0],
    sequence: [0, 255, 0],
  },
  {
    name: "resumed-sequence",
    steps: [
      ["tick", 0],
      ["tick", 50],
      ["command", "pause"],
      ["tick", 500],
      ["command", "resume"],
      ["tick", 550],
    ],
    selected: [255, 0, 0],
    sequence: [0, 0, 255],
  },
  {
    name: "lazy-recreate",
    steps: [
      ["tick", 0],
      ["command", "next"],
      ["tick", 50],
      ["command", "green"],
      ["command", "back"],
      ["tick", 100],
    ],
    selected: [0, 255, 0],
    sequence: [255, 0, 0],
  },
];
for (const scenario of scenarios) {
  const m = await create({
    wasmBinary: await readFile(
      path.join(repositoryRoot, "packages/studio/public/runtime/lvp.wasm"),
    ),
  });
  const f = (n, r, a = []) => m.cwrap("lvp_preview_" + n, r, a);
  for (const asset of await projectAssets(project)) {
    m.FS.mkdirTree("/" + path.posix.dirname(asset.path));
    m.FS.writeFile("/" + asset.path, Buffer.from(asset.base64, "base64"));
  }
  const bytes = encodePackage(project.ir),
    ptr = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, ptr);
  assert.equal(
    f("load", "number", ["number", "number"])(ptr, bytes.length),
    0,
    f("error", "string")(),
  );
  m._free(ptr);
  let now = 0;
  for (const [kind, value] of scenario.steps) {
    if (kind === "tick") {
      now = value;
      f("tick", null, ["number"])(now);
    } else {
      const id = f("command", "number", ["string"])(value);
      assert.ok(id > 0);
      assert.equal(f("command_state", "number", ["number"])(id), 1);
    }
  }
  f("tick", null, ["number"])(now);
  assert.equal(f("resident_nodes", "number")(), 5);
  const p = f("pixels", "number")(),
    rgb = Buffer.alloc(80 * 60 * 3);
  for (let i = 0; i < 80 * 60; i++) {
    rgb[i * 3] = m.HEAPU8[p + i * 4 + 2];
    rgb[i * 3 + 1] = m.HEAPU8[p + i * 4 + 1];
    rgb[i * 3 + 2] = m.HEAPU8[p + i * 4];
  }
  assert.deepEqual([...rgb.subarray(0, 3)], scenario.selected, scenario.name);
  assert.deepEqual(
    [...rgb.subarray(12 * 3, 12 * 3 + 3)],
    scenario.sequence,
    scenario.name,
  );
  assert.deepEqual(
    [...rgb.subarray(24 * 3, 24 * 3 + 3)],
    [0, 0, 0],
    "explicit opacity wins independently of XML attribute order",
  );
  const stepFile = path.join(out, scenario.name + ".tsv");
  await writeFile(
    stepFile,
    scenario.steps.map((s) => s.join("\t")).join("\n") + "\n",
  );
  for (const [kind, binary] of [
    ["native", native],
    ["generated", generated],
  ]) {
    const ppm = path.join(out, `${scenario.name}-${kind}.ppm`);
    await run(
      binary,
      [
        ...(kind === "native"
          ? ["--package", path.join(project.root, ".lvglplus/generated/ui.lvp")]
          : []),
        "--steps",
        stepFile,
        "--out",
        ppm,
      ],
      project.root,
    );
    const image = await readFile(ppm);
    assert.deepEqual(
      image.subarray("P6\n80 60\n255\n".length),
      rgb,
      `${scenario.name}: ${kind} = WASM pixels`,
    );
  }
  f("close", null)();
}
console.log(
  "4 media scenarios: native = generated C = WASM; bounded sources, invalid-index retention, pause/resume, lazy recreation and transparent layers passed",
);
