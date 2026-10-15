// SPDX-License-Identifier: Apache-2.0
// Assemble self-contained local npm archives. Does not publish to any registry.
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  cli = path.join(root, "packages/cli"),
  assets = path.join(cli, "assets"),
  out = path.join(root, "build/releases");
await access(path.join(root, "packages/studio/dist/runtime/lvp.wasm"));
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await mkdir(out, { recursive: true });
const filter = (name) =>
  !name
    .split(path.sep)
    .some((p) => [".git", ".lvglplus", "__pycache__"].includes(p));
for (const entry of [
  "CMakeLists.txt",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "requirements-build.txt",
  "sdk",
  "scripts",
  "cmake",
  "examples",
  "docs/lvglplus",
  "docs/lvglpro",
])
  await cp(path.join(root, entry), path.join(assets, entry), {
    recursive: true,
    filter,
  });
await cp(
  path.join(root, "packages/studio/dist"),
  path.join(assets, "packages/studio/dist"),
  { recursive: true },
);
// Preserve full notices for npm dependencies whose code is bundled into Studio.
const notices = [];
async function collectLicenses(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.startsWith("@"))
      await collectLicenses(file);
    else if (entry.isDirectory() || entry.isSymbolicLink()) {
      let files;
      try {
        files = await readdir(file);
      } catch {
        continue;
      }
      for (const name of files.filter((n) =>
        /^(licen[cs]e|copying|notice)([.-]|$)/i.test(n),
      )) {
        try {
          notices.push(
            `\n===== ${path.relative(path.join(root, "node_modules/.pnpm"), file)} / ${name} =====\n${await readFile(path.join(file, name), "utf8")}\n`,
          );
        } catch {
          /* Some dependencies use a license directory. */
        }
      }
    }
  }
}
for (const entry of (
  await readdir(path.join(root, "node_modules/.pnpm"))
).sort()) {
  const directory = path.join(
    root,
    "node_modules/.pnpm",
    entry,
    "node_modules",
  );
  try {
    await collectLicenses(directory);
  } catch {
    /* Store metadata files. */
  }
}
if (!notices.length) throw new Error("Dependency license collection failed");
await writeFile(
  path.join(assets, "THIRD_PARTY_LICENSES.txt"),
  notices.join("\n"),
);
await cp(path.join(root, ".deps/lvgl"), path.join(assets, ".deps/lvgl"), {
  recursive: true,
  filter: (name) =>
    filter(name) &&
    !path
      .relative(path.join(root, ".deps/lvgl"), name)
      .split(path.sep)
      .some((p) => ["docs", "demos", "examples", "tests"].includes(p)),
});
await writeFile(
  path.join(assets, ".deps/lvgl/LVGLPLUS_REVISION"),
  "85aa60d18b3d5e5588d7b247abf90198f07c8a63\n",
);
for (const pkg of ["compiler", "cli"]) {
  await cp(
    path.join(root, "LICENSE"),
    path.join(root, "packages", pkg, "LICENSE"),
  );
  await cp(
    path.join(root, "NOTICE"),
    path.join(root, "packages", pkg, "NOTICE"),
  );
  const result = spawnSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: path.join(root, "packages", pkg),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Local release archives: ${out}`);
