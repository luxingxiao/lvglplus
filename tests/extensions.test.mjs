// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import { existsSync } from "node:fs";
const hasRuntime = existsSync("packages/studio/dist/runtime/lvp.wasm");
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, cp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { compile, encodePackage } from "../packages/compiler/dist/index.js";
import { loadProject } from "../packages/cli/dist/project.js";
import {
  budget,
  createBundle,
  verifyBundle,
  installBundle,
  rollbackBundle,
  exportViewer,
} from "../packages/cli/dist/artifacts.js";
import { importFigma } from "../packages/cli/dist/figma.js";
import { ModelSession } from "../packages/cli/dist/session.js";
import { migrate } from "../packages/cli/dist/migrate.js";
const manifest = {
  formatVersion: 1,
  name: "extended",
  ui: "ui.xml",
  model: "model.xml",
  lvglVersion: "9.5.0",
  targets: [{ name: "test", width: 160, height: 100 }],
};
const input = {
  manifest,
  model: '<model version="1"><signal name="n"/></model>',
  ui: '<dashboard version="1" locale="en"><translations><locale name="en"><message key="greeting" value="Hello"/></locale><locale name="de"><message key="greeting" value="Hallo"/></locale></translations><page id="home"><text id="t" textKey="greeting"><animate property="x" from="0" to="100" durationMs="1000"/></text></page></dashboard>',
};
test("translations and animation compile to shared properties and reject ambiguous inputs", () => {
  const r = compile(input);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ir.pages[0].children[0].props["l10n.de"], "Hallo");
  assert.equal(r.ir.pages[0].children[0].props["anim.x"], "0,100,1000,0,0,0");
  const exponent = compile({
    ...input,
    ui: input.ui.replace('durationMs="1000"', 'durationMs="1e3"'),
  });
  assert.equal(
    exponent.ir.pages[0].children[0].props["anim.x"],
    "0,100,1000,0,0,0",
  );
  for (const ui of [
    input.ui.replace('value="Hallo"', 'key2="x"'),
    input.ui.replace('durationMs="1000"', 'durationMs="0"'),
    input.ui.replace('property="x"', 'property="runScript"'),
    input.ui.replace('textKey="greeting"', 'textKey="missing"'),
  ])
    assert.equal(compile({ ...input, ui }).ir, undefined);
});
test("bundles verify, reject tampering, install to A/B slots and roll back", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-bundle-"));
  try {
    const p = await loadProject("examples/vehicle"),
      a = path.join(temp, "bundle"),
      store = path.join(temp, "device");
    await createBundle(p, a);
    await verifyBundle(a);
    assert.equal((await installBundle(a, store)).slot, "A");
    assert.equal((await installBundle(a, store)).slot, "B");
    assert.equal((await rollbackBundle(store)).slot, "A");
    const bytes = await readFile(path.join(a, "ui.lvpb"));
    bytes[40] ^= 1;
    await writeFile(path.join(a, "ui.lvpb"), bytes);
    await assert.rejects(verifyBundle(a), /checksum/);
    await assert.rejects(installBundle(a, store));
    assert.equal(
      JSON.parse(await readFile(path.join(store, "active.json"), "utf8")).slot,
      "A",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test("Figma import is deterministic, preserves extensions and rejects edited generated files", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-figma-"));
  try {
    const file = path.join(temp, "input.json"),
      out = path.join(temp, "project");
    await writeFile(
      file,
      JSON.stringify({
        format: "lvglplus-figma",
        version: 1,
        frame: {
          id: "f_root",
          type: "FRAME",
          width: 320,
          height: 240,
          children: [
            {
              id: "f_text",
              type: "TEXT",
              text: "Speed",
              width: 100,
              height: 30,
              fontSize: 20,
              signal: "speed",
            },
          ],
        },
        assets: [],
      }),
    );
    await importFigma(file, out);
    await loadProject(out);
    const before = await readFile(path.join(out, "design.xml"));
    await mkdir(path.join(out, "extensions"));
    await writeFile(path.join(out, "extensions/app.c"), "user code");
    await importFigma(file, out);
    assert.deepEqual(await readFile(path.join(out, "design.xml")), before);
    assert.equal(
      await readFile(path.join(out, "extensions/app.c"), "utf8"),
      "user code",
    );
    await writeFile(path.join(out, "design.xml"), "edited");
    await assert.rejects(importFigma(file, out), /Generated file edited/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test(
  "resource budget exposes allocation estimates; Viewer contains real WASM and no server dependency",
  { skip: !hasRuntime && "Build WASM first" },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-viewer-"));
    try {
      const p = await loadProject("examples/vehicle");
      const b = await budget(p);
      assert.equal(b.targets[0].framebufferBytes, 800 * 480 * 4);
      await exportViewer(p, path.join(temp, "viewer"));
      assert(
        (await readFile(path.join(temp, "viewer/runtime/lvp.wasm"))).length >
          10000,
      );
      assert.match(
        await readFile(path.join(temp, "viewer/viewer.js"), "utf8"),
        /lvp_preview_/,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
test("draft manifest migration validates before writing a separate project", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-migrate-"));
  try {
    const old = path.join(temp, "old");
    await cp("examples/vehicle", old, {
      recursive: true,
      filter: (p) => !p.includes(".lvglplus"),
    });
    const p = JSON.parse(
      await readFile(path.join(old, "plus.project.json"), "utf8"),
    );
    const { ui, model, targets, ...rest } = p;
    await writeFile(
      path.join(old, "plus.project.json"),
      JSON.stringify({
        ...rest,
        formatVersion: 0,
        view: ui,
        dataModel: model,
        resolutions: targets,
      }),
    );
    const out = path.join(temp, "new");
    await migrate(old, out);
    await loadProject(out);
    assert.equal(
      JSON.parse(await readFile(path.join(old, "plus.project.json"), "utf8"))
        .formatVersion,
      0,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test("MCP stdio negotiates, lists tools, validates and rejects invalid model writes", async () => {
  const requests = [
    { method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { method: "tools/list" },
    { method: "tools/call", params: { name: "validate" } },
    {
      method: "tools/call",
      params: {
        name: "model_write",
        arguments: { signal: "vm.speedMph", value: 7 },
      },
    },
  ];
  if (hasRuntime)
    requests.push(
      {
        method: "tools/call",
        params: {
          name: "model_write",
          arguments: { signal: "vehicle.speed", value: 50 },
        },
      },
      { method: "tools/call", params: { name: "model_read" } },
      { method: "tools/call", params: { name: "screenshot" } },
    );
  const child = spawn(process.execPath, [
    "packages/cli/dist/main.js",
    "mcp",
    "examples/vehicle",
  ]);
  let out = "",
    err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  child.stdin.end(
    requests
      .map((r, i) => JSON.stringify({ jsonrpc: "2.0", id: i, ...r }))
      .join("\n") + "\n",
  );
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 0, err);
  const replies = out.trim().split("\n").map(JSON.parse);
  assert.equal(replies[0].result.protocolVersion, "2025-06-18");
  assert(replies[1].result.tools.some((t) => t.name === "screenshot"));
  assert.equal(replies[3].result.isError, true);
  if (hasRuntime) {
    const values = JSON.parse(replies[5].result.content[0].text);
    assert.equal(values.find((s) => s.name === "vehicle.speed").value, 50);
    assert(
      Math.abs(values.find((s) => s.name === "vm.speedMph").value - 31.06855) <
        0.00001,
    );
    assert.equal(replies[6].result.content[0].mimeType, "image/png");
    assert.equal(
      Buffer.from(replies[6].result.content[0].data, "base64").readUInt32BE(0),
      0x89504e47,
    );
  }
});

test(
  "custom runtime uses trusted tool glue and never imports project JavaScript",
  { skip: !hasRuntime && "Build WASM first" },
  async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-glue-"));
    try {
      await cp("examples/vehicle", temp, {
        recursive: true,
        filter: (p) => !p.includes(".lvglplus"),
      });
      const file = path.join(temp, "plus.project.json"),
        manifest = JSON.parse(await readFile(file, "utf8"));
      manifest.native = { sources: ["widget.c"] };
      await writeFile(file, JSON.stringify(manifest));
      await writeFile(path.join(temp, "widget.c"), "/* user C */");
      await mkdir(path.join(temp, ".lvglplus/runtime"), { recursive: true });
      await cp(
        "packages/studio/dist/runtime/lvp.wasm",
        path.join(temp, ".lvglplus/runtime/lvp.wasm"),
      );
      await writeFile(
        path.join(temp, ".lvglplus/runtime/lvp.js"),
        "throw new Error('Project JavaScript must never execute')",
      );
      const runtime = await new ModelSession(await loadProject(temp)).open();
      assert.equal(runtime.read()[0].name, "vehicle.speed");
      runtime.close();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
