import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compile,
  flatten,
  encodePackage,
  generateC,
} from "../packages/compiler/dist/index.js";
const manifest = {
  formatVersion: 1,
  name: "declarative",
  ui: "dashboard.xml",
  model: "model.xml",
  lvglVersion: "9.5.0",
  targets: [{ name: "desktop", width: 840, height: 480 }],
};
const model = `<model version="1"><signal name="run" type="boolean" initial="true"/><signal name="count" type="integer"/><clock name="sim" running="run"/><collection name="members" capacity="3"><field name="speed" initial="2"/><computed name="x" expression="sin(sim.ms/1000 + \${index}) * 30"/></collection><computed name="total" expression="sum(members.speed)"/><action name="step"><set target="count" expression="count+1"/></action><timer clock="sim" intervalMs="100" command="step"/><machine name="page" initial="home"><state name="home"><on event="next" target="radar"/></state><state name="radar"><on event="next" target="home"/></state></machine></model>`;
const ui = `<dashboard version="1"><inputs><key action="confirm" command="next"/></inputs><page id="home"><repeat collection="members"><panel id="member"><bind property="x" signal="\${item.x}"/><text id="label" text="\${index}"/></panel></repeat><path id="route" points="0,0 20,20 30,10" curve="catmull-rom"><bind property="p1x" expression="clamp(count,0,100)"/></path><sector id="scan" width="100" height="100"><bind property="rotation" expression="sim.ms/10"/></sector></page></dashboard>`;
const probe = (m = model, u = ui) => compile({ manifest, model: m, ui: u });
test("bounded collections, repeats, reductions, inline expressions and state/timer program lower deterministically", () => {
  const result = probe();
  assert.deepEqual(result.diagnostics, []);
  const ir = result.ir;
  assert.equal(ir.formatVersion, 3);
  assert.equal(ir.program.clocks.length, 1);
  assert.equal(ir.program.actions.length, 3);
  assert.equal(ir.program.timers.length, 1);
  assert.equal(flatten(ir).filter((n) => n.kind === "text").length, 3);
  assert.equal(new Set(flatten(ir).map((n) => n.id)).size, flatten(ir).length);
  assert.equal(ir.pages[0].props["input.confirm"], "next");
  assert.deepEqual(encodePackage(ir), encodePackage(probe().ir));
  assert.match(generateC(ir)["ui_gen.c"], /lvp_program program/);
});
test("bad geometry, missing states, unbounded collections, conflicting writes and recursive calculations diagnose at source", () => {
  for (const [m, u, code] of [
    [model.replace('capacity="3"', 'capacity="999"'), ui, "COLLECTION"],
    [model, ui.replace("p1x", "p63x"), "BIND_POINT"],
    [model, ui.replace("0,0 20,20 30,10", "Infinity,0 1,2"), "GEOMETRY"],
    [model.replace('target="radar"', 'target="missing"'), ui, "TRANSITION"],
    [model.replace("count+1", "sqrt(-1) + unknown()"), ui, "EXPRESSION"],
    [
      model.replace(
        '<set target="count" expression="count+1"/>',
        '<set target="count" expression="1"/><set target="count" expression="2"/>',
      ),
      ui,
      "ASSIGNMENT",
    ],
  ]) {
    const r = probe(m, u);
    assert.equal(r.ir, undefined);
    const d = r.diagnostics.find((d) => d.code === code);
    assert.ok(d, JSON.stringify(r.diagnostics));
    assert.ok(d.line > 0 && d.column > 0);
  }
});

test("shared C runtime: scheduled snapshots, transitive clusters, fit scale, typed arguments and atomic rejection", async (t) => {
  const { existsSync } = await import("node:fs");
  const { readFile } = await import("node:fs/promises");
  if (!existsSync("packages/studio/public/runtime/lvp.wasm")) {
    t.skip("Build WASM to execute shared runtime checks");
    return;
  }
  const { default: create } = await import(
    "../packages/studio/public/runtime/lvp.js"
  );
  const source = `<model version="1"><signal name="answer" type="integer"/><clock name="sim"/><collection name="positions" capacity="3"><field name="x" initial="\${index}"/><field name="y"/></collection><collection name="motion" capacity="1"><computed name="x" expression="sim.ms"/></collection><snapshot name="seen" collection="motion" fields="x" clock="sim" intervalMs="100"/><computed name="group" expression="clusterId(positions,2,1.1)"/><computed name="size" expression="clusterSize(positions,0,1.1)"/><computed name="center" expression="clusterX(positions,0,1.1)"/><computed name="zoom" expression="fitScale(positions,10,10,1,8,0)"/><action name="answer" parameter="integer" guard="arg()&gt;=0 &amp;&amp; arg()&lt;6"><set target="answer" expression="arg()"/></action></model>`;
  const result = compile({
    manifest,
    model: source,
    ui: '<dashboard version="1"><page id="home"><button id="answerButton" text="Answer"><on event="click" command="answer" argument="4"/></button></page></dashboard>',
  });
  assert.deepEqual(result.diagnostics, []);
  const bytes = encodePackage(result.ir);
  const execute = async (times) => {
    const m = await create({
      wasmBinary: await readFile("packages/studio/public/runtime/lvp.wasm"),
    });
    const wrap = (name, ret, args = []) =>
        m.cwrap("lvp_preview_" + name, ret, args),
      load = wrap("load", "number", ["number", "number"]);
    const p = m._malloc(bytes.length);
    m.HEAPU8.set(bytes, p);
    assert.equal(load(p, bytes.length), 0);
    m._free(p);
    const tick = wrap("tick", null, ["number"]);
    for (const time of times) tick(time);
    const get = wrap("number", "number", ["number"]),
      read = (name) => get(result.ir.signals.findIndex((s) => s.name === name));
    assert.equal(read("seen.0.x"), 300);
    assert.equal(read("seen.sequence"), 3);
    assert.equal(read("group"), 0);
    assert.equal(read("size"), 3);
    assert.equal(read("center"), 1);
    assert.equal(read("zoom"), 5);
    const send = wrap("command_number", "number", ["string", "number"]),
      state = wrap("command_state", "number", ["number"]);
    assert.equal(state(send("answer", 4)), 1);
    assert.equal(read("answer"), 4);
    assert.equal(state(send("answer", 7)), 2);
    assert.equal(state(send("answer", 3.5)), 2);
    assert.equal(read("answer"), 4);
    assert.equal(state(wrap("command", "number", ["string"])("answer")), 2);
    const damaged = bytes.slice();
    new DataView(damaged.buffer).setUint32(4, 99, true);
    const ptr = m._malloc(damaged.length);
    m.HEAPU8.set(damaged, ptr);
    assert.equal(load(ptr, damaged.length), -1);
    assert.equal(read("answer"), 4);
    m._free(ptr);
    wrap("close", null)();
  };
  await execute([0, 350]);
  await execute([0, 100, 200, 300, 350]);
});
