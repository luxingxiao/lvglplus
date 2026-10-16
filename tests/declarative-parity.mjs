// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadProject,
  generateProject,
  repositoryRoot,
} from "../packages/cli/dist/project.js";
import { buildNative, run, ppmToPng } from "../packages/cli/dist/build.js";
import { encodePackage, flatten } from "../packages/compiler/dist/index.js";
const project = await loadProject(path.join(repositoryRoot, "examples/rider"));
const out = path.join(project.root, ".lvglplus/parity");
await mkdir(out, { recursive: true });
await generateProject(project);
assert.ok(
  !project.manifest.native,
  "The acceptance example must not use project C sources",
);
const bytes = encodePackage(project.ir),
  packagePath = path.join(out, "ui.lvp");
await writeFile(packagePath, bytes);
const interpreted = await buildNative(project),
  generated = await buildNative(project, true);
const create = (
  await import(
    pathToFileURL(path.join(project.root, ".lvglplus/runtime/lvp.js")).href
  )
).default;
const scenarios = [
  {
    name: "home",
    steps: [
      ["tick", 1000],
      ["tick", 2000],
      ["tick", 3000],
    ],
  },
  {
    name: "radar",
    steps: [
      ["command", "openRadar"],
      ["tick", 1000],
      ["input", "down"],
      ["tick", 2000],
      ["input", "confirm"],
      ["tick", 3000],
    ],
  },
  {
    name: "team",
    steps: [
      ["command", "openTeam"],
      ["tick", 1000],
      ["tick", 2000],
      ["command", "phase"],
      ["command", "phase"],
      ["command", "phase"],
      ["tick", 3000],
    ],
  },
  {
    name: "messages",
    steps: [
      ["command", "openTeam"],
      ...Array.from({ length: 3 }, () => [
        ...Array.from({ length: 6 }, (_, i) => ["number", "send", i]),
        ["command", "role"],
      ]).flat(),
      ["tick", 2000],
    ],
  },
  {
    name: "pause-rate",
    steps: [
      ["tick", 1000],
      ["command", "pause"],
      ["tick", 2000],
      ["command", "pause"],
      ["command", "rate"],
      ["tick", 2500],
    ],
  },
];
for (const scenario of scenarios) {
  const m = await create({
    wasmBinary: await readFile(
      path.join(project.root, ".lvglplus/runtime/lvp.wasm"),
    ),
  });
  const f = (n, r, a = []) => m.cwrap("lvp_preview_" + n, r, a);
  const load = f("load", "number", ["number", "number"]),
    tick = f("tick", null, ["number"]),
    command = f("command", "number", ["string"]),
    action = f("action", "number", ["string"]),
    state = f("command_state", "number", ["number"]),
    get = f("number", "number", ["number"]),
    quality = f("quality", "number", ["number"]);
  const ptr = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, ptr);
  assert.equal(load(ptr, bytes.length), 0);
  m._free(ptr);
  tick(0);
  let now = 0;
  for (const [kind, value, argument] of scenario.steps) {
    if (kind === "tick") {
      now = value;
      tick(now);
    } else {
      const id =
        kind === "number"
          ? f("command_number", "number", ["string", "number"])(value, argument)
          : (kind === "command" ? command : action)(value);
      assert.ok(id > 0, `${scenario.name}: ${value}`);
      assert.equal(state(id), 1, `${scenario.name}: ${value}`);
    }
  }
  tick(now);
  if (scenario.name === "messages") {
    assert.equal(
      get(project.ir.signals.findIndex((s) => s.name === "messages")),
      18,
    );
    assert.equal(
      get(project.ir.signals.findIndex((s) => s.name === "sender")),
      2,
    );
  }
  if (scenario.name === "pause-rate")
    assert.equal(
      get(project.ir.signals.findIndex((s) => s.name === "sim.ms")),
      2000,
    );
  const pixels = f("pixels", "number")(),
    rgb = Buffer.alloc(840 * 480 * 3);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgb[i] = m.HEAPU8[pixels + j + 2];
    rgb[i + 1] = m.HEAPU8[pixels + j + 1];
    rgb[i + 2] = m.HEAPU8[pixels + j];
  }
  const steps = path.join(out, scenario.name + ".steps");
  await writeFile(
    steps,
    scenario.steps.map((s) => s.join("\t")).join("\n") + "\n",
  );
  for (const [label, binary] of [
    ["native", interpreted],
    ["generated", generated],
  ]) {
    const file = path.join(out, `${scenario.name}-${label}.ppm`),
      tree = file + ".tree";
    const stdout = await run(binary, [
      ...(label === "native" ? ["--package", packagePath] : []),
      "--steps",
      steps,
      "--at",
      String(now),
      "--out",
      file,
      "--tree",
      tree,
    ]);
    const ppm = await readFile(file),
      start = ppm.indexOf(Buffer.from("\n255\n")) + 5;
    assert.deepEqual(
      ppm.subarray(start),
      rgb,
      scenario.name + " " + label + " pixels",
    );
    const png = ppmToPng(ppm);
    await writeFile(file.replace(".ppm", ".png"), png);
    if (
      label === "native" &&
      ["home", "radar", "team"].includes(scenario.name)
    ) {
      const baseline = path.join(
        project.root,
        "baselines",
        scenario.name + ".png",
      );
      if (process.argv.includes("--update-baselines")) {
        await mkdir(path.dirname(baseline), { recursive: true });
        await writeFile(baseline, png);
      } else
        assert.deepEqual(
          await readFile(baseline),
          png,
          "Reviewed visual baseline: " + scenario.name,
        );
    }
    for (const line of stdout.trim().split("\n")) {
      const [name, value, q] = line.split("\t"),
        index = project.ir.signals.findIndex((s) => s.name === name);
      assert.ok(index >= 0);
      assert.ok(
        Math.abs(get(index) - Number(value)) < 1e-7,
        `${scenario.name} ${name}`,
      );
      assert.equal(quality(index), Number(q));
    }
    const rows = (await readFile(tree, "utf8")).trim().split("\n");
    for (const [i, node] of flatten(project.ir).entries()) {
      const p = m._malloc(16);
      assert.equal(f("bounds", "number", ["number", "number"])(i, p), 0);
      assert.deepEqual(
        Array.from(m.HEAP32.subarray(p / 4, p / 4 + 4)),
        rows[i].split("\t").slice(2).map(Number),
        node.id,
      );
      m._free(p);
    }
  }
  // Transactional package reload retains application Model state and rejects corrupt candidates.
  const before = get(0),
    p = m._malloc(bytes.length);
  m.HEAPU8.set(bytes, p);
  assert.equal(load(p, bytes.length), 0);
  assert.equal(get(0), before);
  assert.equal(load(p, 10), -1);
  assert.equal(get(0), before);
  m._free(p);
  f("close", null)();
  console.log(
    scenario.name +
      ": native / generated C / WASM pixels, bounds and Model agree",
  );
}
console.log(
  `${project.ir.signals.length} signals, ${flatten(project.ir).length} nodes, no application C. Evidence: ${out}`,
);
