import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../packages/cli/dist/project.js";
import {
  parseReplay,
  ReplayPlayer,
  simulate,
} from "../packages/cli/dist/data.js";
import { readFile } from "node:fs/promises";
const p = await loadProject(
  fileURLToPath(new URL("../examples/vehicle", import.meta.url)),
);
test("simulation respects declared types and signal boundary", () => {
  const events = simulate(p.ir, p.sources, 9000, 10000);
  assert.equal(events.find((e) => e.signal === "vehicle.speed").value, 128);
  assert.equal(
    typeof events.find((e) => e.signal === "lights.left").value,
    "boolean",
  );
  assert(events.every((e) => e.timestampMs === 10000 && e.quality === "valid"));
  assert(!events.some((e) => e.signal.startsWith("vm.")));
});
test("recorded data supports deterministic pause, speed, backward seek and reset", async () => {
  const rows = parseReplay(
    await readFile(
      new URL("../examples/vehicle/drive.jsonl", import.meta.url),
      "utf8",
    ),
    p.ir,
  );
  const player = new ReplayPlayer(rows, p.ir);
  assert.equal(
    player.advance(10000).find((e) => e.signal === "vehicle.speed").value,
    0,
  );
  assert.equal(
    player
      .advance(11000)
      .filter((e) => e.signal === "vehicle.speed")
      .at(-1).value,
    38,
  );
  player.paused = true;
  assert.deepEqual(player.advance(15000), []);
  assert.equal(player.positionMs, 1000);
  player.paused = false;
  player.setSpeed(2);
  player.advance(15500);
  assert.equal(player.positionMs, 2000);
  assert.equal(
    player.seek(500, 16000).find((e) => e.signal === "vehicle.speed").value,
    15,
  );
  assert.equal(
    player.seek(0, 17000).find((e) => e.signal === "vehicle.speed").value,
    0,
  );
});
test("replay rejects unordered records, derived writes and malformed values", () => {
  assert.throws(
    () => parseReplay('{"atMs":5,"values":{}}\n{"atMs":0,"values":{}}', p.ir),
    /nondecreasing/,
  );
  assert.throws(
    () => parseReplay('{"atMs":0,"values":{"vm.speedMph":1}}', p.ir),
    /Invalid replay/,
  );
  assert.throws(() =>
    parseReplay('{"atMs":0,"values":{"lights.left":2}}', p.ir),
  );
  assert.throws(() => new ReplayPlayer([], p.ir).setSpeed(0));
});
