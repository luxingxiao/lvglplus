// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { compile } from "@lvglplus/compiler";
import { inside, loadProject } from "./project.js";
import { ownedOutput } from "./artifacts.js";
// The only supported legacy input is the documented Plus draft-0 manifest.
// Source UI/model version 1 is preserved; unsupported languages require an explicit migration.
export async function migrate(folder: string, output: string) {
  const old = JSON.parse(
    await readFile(await inside(folder, "plus.project.json"), "utf8"),
  );
  if (old.formatVersion === 1) {
    await loadProject(folder);
    return { changed: false, version: 1 };
  }
  if (
    old.formatVersion !== 0 ||
    typeof old.view !== "string" ||
    typeof old.dataModel !== "string"
  )
    throw Error("Unsupported migration source");
  const { view, dataModel, resolutions, formatVersion, ...rest } = old;
  const manifest = {
    ...rest,
    formatVersion: 1,
    ui: view,
    model: dataModel,
    lvglVersion: "9.5.0",
    targets: resolutions,
  };
  const ui = await readFile(await inside(folder, view), "utf8"),
    model = await readFile(await inside(folder, dataModel), "utf8");
  const result = compile({ manifest, ui, model });
  if (!result.ir)
    throw Error(result.diagnostics.map((d) => d.message).join("\n"));
  if (
    path.resolve(folder) === path.resolve(output) ||
    path.resolve(output).startsWith(path.resolve(folder) + path.sep)
  )
    throw Error("Migration requires a separate output directory");
  await ownedOutput(output, "migration", async (temp) => {
    await cp(folder, temp, {
      recursive: true,
      filter: (name) =>
        ![".git", ".lvglplus", "node_modules"].includes(path.basename(name)),
    });
    await writeFile(
      path.join(temp, "plus.project.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await loadProject(temp);
  });
  return { changed: true, version: 1, output };
}
