import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { serve } from "../packages/cli/dist/server.js";
import {
  inside,
  loadProject,
  generateProject,
  initProject,
} from "../packages/cli/dist/project.js";

test("init accepts an empty destination and protects an existing project", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-init-"));
  try {
    await initProject(temp);
    const project = await loadProject(temp);
    assert.equal(project.ir.pages.length, 2);
    await assert.rejects(initProject(temp), /empty|exists|overwrite/i);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("local server rejects unauthorized writes/origins and keeps last valid project", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-server-"));
  await cp("examples/vehicle", temp, {
    recursive: true,
    filter: (s) => !s.includes(".lvglplus"),
  });
  const app = await serve(temp, 0);
  try {
    const session = await (await fetch(app.url + "/api/session")).json();
    assert(session.token);
    assert.equal(
      (await fetch(app.url + "/api/data", { method: "POST", body: "{}" }))
        .status,
      403,
    );
    assert.equal(
      (
        await fetch(app.url + "/api/session", {
          headers: { Origin: "https://outside.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        const r = http.get(
          app.url + "/api/session",
          { headers: { Host: "outside.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        r.on("error", reject);
      }),
      403,
    );
    const post = (url, value) =>
      fetch(app.url + url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Lvglplus-Token": session.token,
        },
        body: JSON.stringify(value),
      });
    assert.equal(
      (await post("/api/data", { signal: "vm.speedMph", value: 1 })).status,
      400,
    );
    assert.equal(
      (await post("/api/file", { file: "../escape", content: "bad" })).status,
      400,
    );
    const before = Buffer.from(
      await (await fetch(app.url + "/api/package")).arrayBuffer(),
    );
    const save = await (
      await post("/api/file", { file: "dashboard.xml", content: "<broken>" })
    ).json();
    assert.equal(save.valid, false);
    assert.deepEqual(
      Buffer.from(await (await fetch(app.url + "/api/package")).arrayBuffer()),
      before,
    );
    assert.equal(
      await readFile(path.join(temp, "dashboard.xml"), "utf8"),
      "<broken>",
    );
    assert.equal((await post("/api/source", { mode: "manual" })).status, 200);
    assert.equal(
      (await post("/api/data", { signal: "vehicle.speed", value: 42 })).status,
      200,
    );
  } finally {
    await app.close();
    await rm(temp, { recursive: true, force: true });
  }
});
test("filesystem boundary resolves symlinks and invalid input never overwrites generated output", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "lvp-project-"));
  await cp("examples/vehicle", temp, {
    recursive: true,
    filter: (s) => !s.includes(".lvglplus"),
  });
  try {
    await assert.rejects(inside(temp, "../outside"));
    if (process.platform !== "win32") {
      await symlink(os.tmpdir(), path.join(temp, "escape"));
      await assert.rejects(inside(temp, "escape"));
    }
    const project = await loadProject(temp);
    await assert.rejects(generateProject(project, temp), /unowned/);
    const out = await generateProject(project);
    const before = await readFile(path.join(out, "ui_gen.c"));
    await writeFile(path.join(temp, "dashboard.xml"), "<bad>");
    await assert.rejects(loadProject(temp));
    assert.deepEqual(await readFile(path.join(out, "ui_gen.c")), before);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
