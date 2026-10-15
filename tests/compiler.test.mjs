import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  compile,
  flatten,
  encodePackage,
  generateC,
  compileExpression,
} from "../packages/compiler/dist/index.js";
const root = new URL("../examples/vehicle/", import.meta.url);
const input = {
  manifest: JSON.parse(
    await readFile(new URL("plus.project.json", root), "utf8"),
  ),
  ui: await readFile(new URL("dashboard.xml", root), "utf8"),
  model: await readFile(new URL("model.xml", root), "utf8"),
};

test("compiles original vehicle project, components and typed bindings", () => {
  const result = compile(input);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.ir.pages.length, 2);
  const nodes = flatten(result.ir);
  assert(nodes.some((n) => n.id === "home.trip.card.reading"));
  assert.equal(
    nodes.find((n) => n.id === "home.trip.card.reading").props.fontSize,
    "28",
  );
  assert.equal(
    nodes.find((n) => n.id === "brightness").bindings[0].twoWay,
    true,
  );
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length);
});
test("deterministic C and package generation, target resolution", () => {
  const a = compile(input).ir,
    b = compile(input).ir;
  assert.deepEqual(generateC(a), generateC(b));
  assert.deepEqual(encodePackage(a), encodePackage(b));
  assert.notDeepEqual(
    encodePackage(a, a.targets[0]),
    encodePackage(a, a.targets[1]),
  );
  assert.match(generateC(a)["ui_gen.c"], /const lvp_schema vehicle_schema/);
});
test("source diagnostics locate unknown attributes; XML rejects external entities", () => {
  const result = compile({
    ...input,
    ui: input.ui.replace('fontSize="48"', 'imaginary="48"'),
  });
  const error = result.diagnostics.find((d) => d.code === "PROPERTY");
  assert(error);
  assert(error.line > 1);
  assert(error.column > 0);
  assert.equal(result.ir, undefined);
  assert(
    compile({
      ...input,
      ui: '<!DOCTYPE dashboard [<!ENTITY x SYSTEM "file:///etc/passwd">]><dashboard version="1"/>',
    }).diagnostics.some((d) => d.code === "XML_PARSE"),
  );
});
test("derived cycles, unknown names, unsafe format and duplicate IDs fail validation", () => {
  for (const [model, ui, code] of [
    [
      input.model.replace("vehicle.speed * 0.621371", "vm.speedMph + 1"),
      input.ui,
      "DERIVED_CYCLE",
    ],
    [
      input.model.replace("vehicle.speed * 0.621371", "missingSignal + 1"),
      input.ui,
      "EXPRESSION",
    ],
    [input.model, input.ui.replace('format="%.0f"', 'format="%n"'), "FORMAT"],
    [input.model, input.ui.replace('id="brand"', 'id="speed"'), "DUPLICATE_ID"],
  ])
    assert(
      compile({ ...input, model, ui }).diagnostics.some((d) => d.code === code),
      code,
    );
});
test("two-way binding cannot mutate derived state or incompatible widget", () => {
  assert(
    compile({
      ...input,
      ui: input.ui.replace(
        'signal="settings.brightness" direction="two-way"',
        'signal="vm.speedMph" direction="two-way"',
      ),
    }).diagnostics.some((d) => d.code === "BIND_TWO_WAY"),
  );
});
test("component recursion and missing component parameters fail before generation", () => {
  assert(
    compile({
      ...input,
      ui: input.ui.replace('caption="BATTERY" ', ""),
    }).diagnostics.some((d) => d.code === "COMPONENT_PARAM"),
  );
  const ui =
    '<dashboard version="1"><component name="loop"><use component="loop"/></component><page id="p"><use component="loop"/></page></dashboard>';
  assert(
    compile({ ...input, ui }).diagnostics.some(
      (d) => d.code === "COMPONENT_CYCLE",
    ),
  );
});
test("expression bytecode has forward branches for lazy conditional and logical evaluation", () => {
  const code = compileExpression(
    "vehicle.speed == 0 ? 0 : 100 / vehicle.speed",
    compile(input).ir.signals,
  );
  assert(code.some((i) => i.op === "jump_false"));
  assert(code.some((i) => i.op === "jump"));
  assert.throws(() => compileExpression("process.exit()", []));
  assert.throws(() => compileExpression("1 ".repeat(200), []));
});
