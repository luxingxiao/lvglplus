// SPDX-License-Identifier: Apache-2.0
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  rename,
  mkdtemp,
  access,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  encodePackage,
  flatten,
  imageSources,
  FORMAT_VERSION,
} from "@lvglplus/compiler";
import { repositoryRoot, inside, type LoadedProject } from "./project.js";

export async function ownedOutput(
  output: string,
  type: string,
  create: (temporary: string) => Promise<void>,
) {
  output = path.resolve(output);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const marker = ".lvglplus-" + type;
  let exists = false;
  try {
    await access(output);
    exists = true;
  } catch {}
  if (exists) {
    let owner = "";
    try {
      owner = await readFile(path.join(output, marker), "utf8");
    } catch {}
    if (owner !== type)
      throw new Error(`Refusing to replace unowned ${type} directory`);
  }
  const temp = await mkdtemp(path.join(parent, ".lvp-" + type + "-")),
    backup = temp + "-backup";
  let moved = false;
  try {
    await create(temp);
    await rm(path.join(temp, marker), { force: true });
    await writeFile(path.join(temp, marker), type, { flag: "wx" });
    if (exists) {
      await rename(output, backup);
      moved = true;
    }
    try {
      await rename(temp, output);
    } catch (e) {
      if (moved) await rename(backup, output);
      throw e;
    }
    if (moved) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return output;
}
export async function projectAssets(project: LoadedProject) {
  const names = [
    ...new Set(
      flatten(project.ir).flatMap((n) =>
        imageSources(n).map((s) => s.slice(2)),
      ),
    ),
  ];
  return Promise.all(
    names.map(async (name) => ({
      path: name,
      base64: (await readFile(await inside(project.root, name))).toString(
        "base64",
      ),
    })),
  );
}
export async function budget(project: LoadedProject) {
  const nodes = flatten(project.ir),
    assets = await projectAssets(project);
  const resources = assets.map((a) => {
    const b = Buffer.from(a.base64, "base64");
    const width = b.readUInt32BE(16),
      height = b.readUInt32BE(20);
    return {
      path: a.path,
      bytes: b.length,
      width,
      height,
      decodedBytes: width * height * 4,
    };
  });
  return {
    nodes: nodes.length,
    signals: project.ir.signals.length,
    packageBytes: encodePackage(project.ir).length,
    targets: project.ir.targets.map((t) => ({
      ...t,
      framebufferBytes: t.width * t.height * 4,
      drawBufferBytes: t.width * 32 * 4,
    })),
    resources,
    assetBytes: resources.reduce((s, r) => s + r.bytes, 0),
    decodedAssetBytes: resources.reduce((s, r) => s + r.decodedBytes, 0),
    estimate:
      "ARGB8888 pixels only; excludes LVGL object/allocator/font overhead. Measure the target heap before production.",
  };
}
export async function exportViewer(
  project: LoadedProject,
  output: string,
  target?: string,
) {
  const selected = project.ir.targets.find(
    (t) => t.name === (target ?? project.ir.targets[0].name),
  );
  if (!selected) throw new Error("Unknown target");
  return ownedOutput(output, "viewer", async (dir) => {
    await cp(
      path.join(repositoryRoot, "packages/studio/dist/runtime"),
      path.join(dir, "runtime"),
      {
        recursive: true,
      },
    );
    if (project.manifest.native?.sources.length)
      await cp(
        path.join(runtimeDirectory(project), "lvp.wasm"),
        path.join(dir, "runtime/lvp.wasm"),
      );
    await cp(path.join(repositoryRoot, "tools/viewer"), dir, {
      recursive: true,
    });
    await writeFile(
      path.join(dir, "ui.lvp"),
      encodePackage(project.ir, selected),
    );
    await writeFile(
      path.join(dir, "project.json"),
      JSON.stringify(
        { ir: project.ir, assets: await projectAssets(project) },
        null,
        2,
      ),
    );
    for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"])
      await cp(path.join(repositoryRoot, file), path.join(dir, file));
    await cp(
      path.join(repositoryRoot, ".deps/lvgl/LICENCE.txt"),
      path.join(dir, "LVGL-LICENSE.txt"),
    );
  });
}
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export async function createBundle(
  project: LoadedProject,
  output: string,
  target?: string,
) {
  const selected = project.ir.targets.find(
    (t) => t.name === (target ?? project.ir.targets[0].name),
  );
  if (!selected) throw new Error("Unknown target");
  const ui = Buffer.from(encodePackage(project.ir, selected)),
    header = Buffer.alloc(32);
  header.write("LVPB");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(3, 8);
  header.writeUInt32LE(0x090500, 12);
  header.writeUInt32LE(ui.length, 16);
  header.writeUInt32LE(crc32(ui), 20);
  const binary = Buffer.concat([header, ui]);
  await ownedOutput(output, "bundle", async (dir) => {
    await writeFile(path.join(dir, "ui.lvpb"), binary);
    const files = [
      {
        path: "ui.lvpb",
        sha256: createHash("sha256").update(binary).digest("hex"),
        bytes: binary.length,
      },
    ];
    for (const asset of await projectAssets(project)) {
      const file = path.join(dir, "resources", asset.path);
      await mkdir(path.dirname(file), { recursive: true });
      const bytes = Buffer.from(asset.base64, "base64");
      await writeFile(file, bytes);
      files.push({
        path: "resources/" + asset.path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
    }
    await writeFile(
      path.join(dir, "bundle.json"),
      JSON.stringify(
        {
          bundleVersion: 1,
          xmlVersion: 1,
          irVersion: FORMAT_VERSION,
          sdkAbi: 3,
          lvglVersion: "9.5.0",
          project: project.ir.name,
          target: selected,
          files,
        },
        null,
        2,
      ) + "\n",
    );
  });
  return output;
}
export async function verifyBundle(root: string) {
  const manifest = JSON.parse(
    await readFile(await inside(root, "bundle.json"), "utf8"),
  );
  if (
    manifest.bundleVersion !== 1 ||
    ![1, 2, 3].includes(manifest.sdkAbi) ||
    ![1, 2, 3, 4].includes(manifest.irVersion) ||
    (manifest.irVersion === 3 && manifest.sdkAbi !== 2) ||
    (manifest.irVersion === 4 && manifest.sdkAbi !== 3) ||
    manifest.lvglVersion !== "9.5.0" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 4096
  )
    throw new Error("Incompatible bundle");
  const names = new Set<string>();
  for (const file of manifest.files) {
    if (
      names.has(file.path) ||
      !/^ui\.lvpb$|^resources\/[\w./-]+$/.test(file.path)
    )
      throw new Error("Invalid bundle path");
    names.add(file.path);
    const bytes = await readFile(await inside(root, file.path));
    if (
      bytes.length !== file.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      throw new Error(`Bundle checksum failed: ${file.path}`);
  }
  if (!names.has("ui.lvpb")) throw new Error("UI payload missing");
  const binary = await readFile(await inside(root, "ui.lvpb"));
  if (
    binary.length < 52 ||
    binary.toString("ascii", 0, 4) !== "LVPB" ||
    binary.readUInt32LE(4) !== 1 ||
    binary.readUInt32LE(8) !== manifest.sdkAbi ||
    binary.readUInt32LE(36) !== manifest.irVersion ||
    binary.readUInt32LE(12) !== 0x090500 ||
    binary.readUInt32LE(16) !== binary.length - 32 ||
    binary.readUInt32LE(20) !== crc32(binary.subarray(32))
  )
    throw new Error("Invalid binary bundle");
  return manifest;
}
// Host filesystem demonstrates the same A/B staging and rollback contract used by firmware storage hooks.
export async function installBundle(bundle: string, store: string) {
  const manifest = await verifyBundle(bundle);
  await mkdir(store, { recursive: true });
  const stateFile = path.join(store, "active.json");
  let state: { slot: string; previous?: string } = { slot: "B" };
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
    if (!["A", "B"].includes(state.slot))
      throw new Error("Invalid active slot");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const next = state.slot === "A" ? "B" : "A";
  const dir = path.join(store, next);
  await ownedOutput(dir, "device-slot", async (temp) => {
    for (const file of [
      "bundle.json",
      ...manifest.files.map((f: { path: string }) => f.path),
    ]) {
      const to = path.join(temp, file);
      await mkdir(path.dirname(to), { recursive: true });
      await cp(await inside(bundle, file), to);
    }
    await verifyBundle(temp);
  });
  const tmp = stateFile + ".tmp";
  await writeFile(tmp, JSON.stringify({ slot: next, previous: state.slot }));
  await rename(tmp, stateFile);
  return { slot: next, previous: state.slot };
}
export async function rollbackBundle(store: string) {
  const stateFile = await inside(store, "active.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  if (!["A", "B"].includes(state.previous) || state.previous === state.slot)
    throw new Error("No valid rollback slot");
  await verifyBundle(await inside(store, state.previous));
  const next = { slot: state.previous, previous: state.slot };
  await writeFile(stateFile + ".tmp", JSON.stringify(next));
  await rename(stateFile + ".tmp", stateFile);
  return next;
}

export function runtimeDirectory(project: LoadedProject) {
  return project.manifest.native?.sources.length ||
    project.manifest.fonts?.length
    ? path.join(project.root, ".lvglplus/runtime")
    : path.join(repositoryRoot, "packages/studio/dist/runtime");
}
