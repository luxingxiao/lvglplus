import test from "node:test";
import assert from "node:assert/strict";
import {
  compile,
  encodePackage,
  imageSources,
} from "../packages/compiler/dist/index.js";
const manifest = {
  formatVersion: 1,
  name: "media_catalog",
  lvglVersion: "9.5.0",
  ui: "ui.xml",
  model: "model.xml",
  targets: [{ name: "desktop", width: 80, height: 60 }],
};
const model =
  '<model version="1"><signal name="selection" type="integer"/><signal name="page" type="integer"/><signal name="playing" type="boolean" initial="true"/><command name="dismiss" target="page" value="0"/></model>';
const image =
  '<image id="photo"><source src="A:assets/red.png"/><source src="A:assets/green.png"/><bind property="source" signal="selection"/></image>';
const check = (body, extra = {}) =>
  compile({
    manifest: { ...manifest, ...extra },
    model,
    ui: `<dashboard version="1"><page id="home" lazy="true" retain="false" pageSignal="page">${body}</page></dashboard>`,
  });
test("bounded image tables preserve file references and stable binding ordinals in v4", () => {
  const r = check(image);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.ir.formatVersion, 4);
  assert.deepEqual(imageSources(r.ir.pages[0].children[0]), [
    "A:assets/red.png",
    "A:assets/green.png",
  ]);
  assert.equal(new DataView(encodePackage(r.ir).buffer).getUint32(4, true), 4);
});
test("frame sequences and modal-local semantic input validate without executable data", () => {
  assert.deepEqual(
    check(
      '<image><source src="A:assets/red.png"/><sequence frameMs="50" repeat="-1"/><bind property="playing" signal="playing"/></image><panel modal="true" priority="200"><input action="back" command="dismiss"/></panel>',
    ).diagnostics,
    [],
  );
  for (const body of [
    '<image><source src="A:../private.png"/></image>',
    '<panel><source src="A:a.png"/></panel>',
    '<image><sequence frameMs="0"/></image>',
    "<image><sequence/></image>",
    '<image><bind property="source" signal="selection"/></image>',
    '<image><source src="A:a.png"/><sequence/><bind property="source" signal="selection"/></image>',
    '<panel modal="true"><input action="back" command="unknown"/></panel>',
    '<panel modal="true" priority="256"/>',
    '<panel lazy="true"/>',
  ])
    assert.ok(check(body).diagnostics.length, body);
});
test("larger projects explicitly opt into bounded capacities; defaults remain constrained", () => {
  const nodes = Array.from(
    { length: 600 },
    (_, i) => `<panel id="p${i}"/>`,
  ).join("");
  assert.ok(check(nodes).diagnostics.some((d) => d.code === "NODE_LIMIT"));
  assert.deepEqual(check(nodes, { limits: { nodes: 1024 } }).diagnostics, []);
  for (const limits of [
    { nodes: 4097 },
    { signals: 1025 },
    { nodes: 0 },
    { signals: 1.5 },
  ])
    assert.ok(
      check("", { limits }).diagnostics.some((d) => d.code === "LIMITS"),
    );
});

test("bounded multi-key timelines validate monotonic times, curve controls and binding conflicts", () => {
  const good =
    '<panel><keyframes property="rotation" repeat="-1"><key atMs="0" value="0"/><key atMs="100" value="90" easing="cubic-bezier" control="0.25,0.1,0.25,1"/></keyframes></panel>';
  assert.deepEqual(check(good).diagnostics, []);
  for (const bad of [
    good.replace('atMs="100"', 'atMs="0"'),
    good.replace("0.25,0.1,0.25,1", "2,0,1,1"),
    good.replace('repeat="-1"', 'repeat="-2"'),
    good.replace(
      "</panel>",
      '<bind property="rotation" signal="selection"/></panel>',
    ),
  ])
    assert.ok(check(bad).diagnostics.length);
});
