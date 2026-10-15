// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { ModelSession } from "../packages/cli/dist/session.js";
import { loadProject } from "../packages/cli/dist/project.js";
const run = (command, args) => {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(command + " failed");
};
const cli = (...args) =>
  run(process.execPath, ["packages/cli/dist/main.js", ...args]);
cli("bundle", "examples/vehicle");
run("cmake", [
  "-S",
  ".",
  "-B",
  "build/extensions",
  "-DBUILD_TESTING=ON",
  "-DLVP_SANITIZE=ON",
]);
run("cmake", ["--build", "build/extensions", "-j", "8"]);
run("ctest", ["--test-dir", "build/extensions", "--output-on-failure"]);
run(path.resolve("build/extensions/lvp_ui_extensions"), [
  path.resolve("examples/vehicle/.lvglplus/bundle/ui.lvpb"),
]);
cli("build", "examples/custom", "--wasm");
cli(
  "screenshot",
  "examples/custom",
  "--at",
  "500",
  "--out",
  "build/custom-native.png",
);
const session = await new ModelSession(
  await loadProject("examples/custom"),
).open();
try {
  session.tick(500);
  assert.equal(session.inspect("animated")[0].bounds[0], 45);
  assert.deepEqual(session.png(), await readFile("build/custom-native.png"));
  const before = session.png();
  session.locale("de");
  assert(!before.equals(session.png()));
  session.write("speed", 75);
  assert.equal(session.read()[0].value, 75);
  console.log(
    "Custom native/WASM exact pixels; deterministic animation; locale switch; shared model passed",
  );
} finally {
  session.close();
}
