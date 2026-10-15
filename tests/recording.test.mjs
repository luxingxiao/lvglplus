// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Recorder } from "../packages/cli/dist/recording.js";
import { parseReplay, ReplayPlayer } from "../packages/cli/dist/data.js";
import { loadProject } from "../packages/cli/dist/project.js";
test("recording persists timestamps/quality and replay preserves stale values", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-rec-"));
  try {
    const file = path.join(temp, "drive.jsonl"),
      r = new Recorder();
    await r.start(file, 1000);
    r.enqueue(
      [
        {
          signal: "vehicle.speed",
          value: 42,
          timestampMs: 1050,
          quality: "stale",
        },
      ],
      1100,
    );
    assert.equal((await r.stop()).error, "");
    const ir = (await loadProject("examples/vehicle")).ir,
      records = parseReplay(await readFile(file, "utf8"), ir),
      p = new ReplayPlayer(records, ir),
      event = p.seek(100, 0).find((e) => e.signal === "vehicle.speed");
    assert.equal(event.value, 42);
    assert.equal(event.timestampMs, 50);
    assert.equal(event.quality, "stale");
    await assert.rejects(r.start(file, 0));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
