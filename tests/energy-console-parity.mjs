// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodePackage } from "../packages/compiler/dist/index.js";
import { loadProject, repositoryRoot } from "../packages/cli/dist/project.js";
import { ModelSession } from "../packages/cli/dist/session.js";
import { buildNative, run, ppmToPng } from "../packages/cli/dist/build.js";

const project = await loadProject(
  path.join(repositoryRoot, "examples/energy-console"),
);
assert.equal(
  project.manifest.native,
  undefined,
  "Example must not depend on custom C",
);
const out = path.join(project.root, ".lvglplus/parity");
await mkdir(out, { recursive: true });
const bytes = encodePackage(project.ir),
  packageFile = path.join(out, "ui.lvp");
await writeFile(packageFile, bytes);
const native = await buildNative(project),
  generated = await buildNative(project, true);
const scenarios = [
  {
    name: "initial",
    steps: [],
    expect: { "plant.ms": 0, load: 62, running: true, economy: false },
  },
  {
    name: "operating",
    steps: [
      ["tick", 750],
      ["tick", 1500],
    ],
    expect: { "plant.ms": 1500, warning: false },
  },
  {
    name: "overload",
    steps: [
      ["command", "stress"],
      ["tick", 1000],
    ],
    expect: { load: 94, temperature: 86, warning: true },
  },
  {
    name: "paused",
    steps: [
      ["tick", 1000],
      ["command", "pause"],
      ["tick", 2000],
    ],
    expect: { "plant.ms": 1000, rpm: 0, running: false },
  },
  {
    name: "fast-reverse",
    steps: [
      ["command", "speed"],
      ["command", "reverse"],
      ["tick", 1250],
    ],
    expect: { "plant.ms": 2500, spin: -87.5, rate: 2, direction: -1 },
  },
  {
    name: "draft",
    steps: [
      ["command", "quality"],
      ["tick", 1500],
    ],
    expect: { economy: true, "plant.ms": 1500 },
  },
  {
    name: "reset",
    steps: [
      ["tick", 1000],
      ...["speed", "reverse", "stress", "quality", "pause", "reset"].map(
        (c) => ["command", c],
      ),
      ["tick", 1000],
    ],
    expect: {
      "plant.ms": 0,
      load: 62,
      running: true,
      rate: 1,
      direction: 1,
      economy: false,
      stress: false,
    },
  },
];
const frames = new Map(),
  states = new Map();
for (const scenario of scenarios) {
  const session = await new ModelSession(project).open();
  try {
    for (const [kind, value] of scenario.steps) {
      if (kind === "tick") session.tick(value);
      else assert.equal(session.command(value).state, "succeeded", value);
    }
    session.tick(session.now);
    const state = session.read(),
      png = session.png(),
      tree = session.inspect();
    frames.set(scenario.name, png);
    states.set(
      scenario.name,
      state.map((s) => ({ ...s, value: s.value === 0 ? 0 : s.value })),
    );
    for (const [name, value] of Object.entries(scenario.expect)) {
      const actual = state.find((s) => s.name === name).value;
      if (typeof value === "number")
        assert(
          Math.abs(Number(actual) - value) < 1e-7,
          `${scenario.name}: ${name}`,
        );
      else assert.equal(actual, value, `${scenario.name}: ${name}`);
    }
    const stepsFile = path.join(out, scenario.name + ".steps");
    await writeFile(
      stepsFile,
      [["tick", 0], ...scenario.steps].map((s) => s.join("\t")).join("\n") +
        "\n",
    );
    for (const [label, binary] of [
      ["native", native],
      ["generated", generated],
    ]) {
      const file = path.join(out, `${scenario.name}-${label}.ppm`),
        treeFile = file + ".tree";
      const stdout = await run(binary, [
        ...(label === "native" ? ["--package", packageFile] : []),
        "--steps",
        stepsFile,
        "--at",
        String(session.now),
        "--out",
        file,
        "--tree",
        treeFile,
      ]);
      const ppm = await readFile(file),
        nativePng = ppmToPng(ppm);
      if (scenario.name === "overload") {
        const offset = ppm.indexOf(Buffer.from("\n255\n")) + 5;
        const pixel = offset + (523 * 1024 + 40) * 3;
        assert.deepEqual(
          [...ppm.subarray(pixel, pixel + 3)],
          [7, 17, 28],
          "Waveform is clipped at the card boundary",
        );
      }
      assert(nativePng.equals(png), `${scenario.name}: ${label}/WASM pixels`);
      await writeFile(file.replace(".ppm", ".png"), nativePng);
      const rows = (await readFile(treeFile, "utf8")).trim().split("\n");
      assert.equal(rows.length, tree.length);
      for (let i = 0; i < tree.length; i++)
        assert.deepEqual(
          rows[i].split("\t").slice(2).map(Number),
          tree[i].bounds,
          `${scenario.name}: ${tree[i].id}`,
        );
      for (const row of stdout.trim().split("\n")) {
        const [name, value, quality] = row.split("\t"),
          signal = state.find((s) => s.name === name);
        assert.ok(signal, name);
        assert.ok(
          Math.abs(Number(signal.value) - Number(value)) < 1e-7,
          `${scenario.name}: ${name}`,
        );
        assert.equal(
          signal.quality,
          ["valid", "stale", "invalid", "disconnected"][Number(quality)],
        );
      }
      if (
        label === "native" &&
        ["initial", "overload", "draft"].includes(scenario.name)
      ) {
        const baseline = path.join(
          project.root,
          "baselines",
          scenario.name + ".png",
        );
        if (process.argv.includes("--update-baselines")) {
          await mkdir(path.dirname(baseline), { recursive: true });
          await writeFile(baseline, nativePng);
        } else
          assert(
            (await readFile(baseline)).equals(nativePng),
            "Reviewed baseline: " + scenario.name,
          );
      }
    }
    console.log(
      `${scenario.name}: native / generated C / WASM pixels, bounds, Model and quality agree`,
    );
  } finally {
    session.close();
  }
}
assert.deepEqual(
  states.get("initial"),
  states.get("reset"),
  "Reset restores all model values and quality",
);
assert.notDeepEqual(
  frames.get("initial"),
  frames.get("operating"),
  "Animation advances",
);
assert.notDeepEqual(
  frames.get("operating"),
  frames.get("draft"),
  "Raster profile visibly changes coverage",
);
// Exercise real LVGL input, independently of direct command invocation.
const ui = await new ModelSession(project).open();
try {
  ui.pointer(90, 560, true);
  ui.pointer(90, 560, false);
  assert.equal(
    ui.read().find((s) => s.name === "running").value,
    false,
    "Pause button dispatches through LVGL",
  );
  ui.pointer(750, 560, true);
  ui.pointer(750, 560, false);
  assert.equal(
    ui.read().find((s) => s.name === "economy").value,
    true,
    "Profile button dispatches through LVGL",
  );
} finally {
  ui.close();
}
console.log(`7 scenarios and LVGL pointer input passed. Evidence: ${out}`);
