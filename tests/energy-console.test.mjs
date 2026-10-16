// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../packages/cli/dist/project.js";
import {
  flatten,
  encodePackage,
  generateC,
} from "../packages/compiler/dist/index.js";

test("energy console compiles independently with bounded geometry, profiles and controls", async () => {
  const p = await loadProject("examples/energy-console");
  assert.equal(p.manifest.native, undefined);
  const nodes = flatten(p.ir);
  assert(!nodes.some((n) => n.kind === "custom"));
  assert(nodes.some((n) => n.kind === "sector" && n.props.radialOpacity));
  assert(nodes.some((n) => n.kind === "sector" && n.props.rasterSize === "64"));
  assert(
    nodes.some((n) => n.kind === "sector" && n.props.rasterSize === "224"),
  );
  assert(nodes.some((n) => n.kind === "path" && n.bindings.length === 12));
  assert(p.ir.program.actions.some((a) => a.name === "reset"));
  assert(nodes.length <= 512 && p.ir.signals.length <= 256);
  assert.deepEqual(
    encodePackage(p.ir),
    encodePackage((await loadProject("examples/energy-console")).ir),
  );
  assert.match(generateC(p.ir)["ui_gen.c"], /lvp_program program/);
});
