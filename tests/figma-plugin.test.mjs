// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
test("Figma Plugin API exporter traverses frames/text and exports raster resources", async () => {
  const text = {
    id: "1:2",
    type: "TEXT",
    name: "Speed",
    x: 10,
    y: 20,
    width: 100,
    height: 30,
    characters: "Speed",
    fontSize: 20,
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    getPluginData: () => "",
  };
  const vector = {
    id: "1:3",
    type: "VECTOR",
    name: "icon",
    x: 5,
    y: 5,
    width: 16,
    height: 16,
    getPluginData: () => "",
    exportAsync: async () => new Uint8Array([1, 2, 3]),
  };
  const root = {
    id: "1:1",
    type: "FRAME",
    name: "Cluster",
    x: 4,
    y: 8,
    width: 320,
    height: 240,
    children: [text, vector],
    getPluginData: () => "",
  };
  let result;
  const figma = {
    showUI: () => {},
    currentPage: { selection: [root] },
    ui: {
      postMessage: (value) => {
        result = value;
      },
    },
  };
  vm.runInNewContext(await readFile("tools/figma/code.js", "utf8"), {
    figma,
    __html__: "",
    Uint8Array,
  });
  await figma.ui.onmessage({ type: "export" });
  assert.equal(result.type, "export");
  assert.equal(result.value.frame.x, 0);
  assert.equal(result.value.frame.children[0].text, "Speed");
  assert.equal(result.value.assets[0].path, "assets/f_1_3.png");
});
