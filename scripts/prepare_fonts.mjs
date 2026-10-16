// SPDX-License-Identifier: Apache-2.0
// Project-declared fonts become generated C; applications never author registration glue.
import { readFile, mkdir, writeFile, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  root = await realpath(process.argv[2]);
const { fonts = [] } = JSON.parse(
  await readFile(path.join(root, "plus.project.json"), "utf8"),
);
if (!Array.isArray(fonts) || fonts.length > 16) throw Error("At most 16 fonts");
if (!fonts.length) {
  console.log("[]");
  process.exit(0);
}
const dir = path.join(root, ".lvglplus/fonts");
await mkdir(dir, { recursive: true });
const converter = createRequire(
  path.join(repository, "packages/cli/package.json"),
).resolve("lv_font_conv/lv_font_conv.js");
const names = new Set(),
  sources = [];
for (const font of fonts) {
  if (
    !/^[A-Za-z_]\w*$/.test(font.name ?? "") ||
    names.has(font.name) ||
    !Number.isInteger(font.size) ||
    font.size < 8 ||
    font.size > 160 ||
    typeof font.characters !== "string" ||
    !font.characters.length ||
    font.characters.length > 8192 ||
    typeof font.file !== "string"
  )
    throw Error("Invalid font declaration");
  names.add(font.name);
  let file;
  if (font.file === "builtin:montserrat")
    file = path.join(
      repository,
      ".deps/lvgl/scripts/built_in_font/Montserrat-Medium.ttf",
    );
  else if (font.file === "builtin:cjk")
    file = path.join(
      repository,
      ".deps/lvgl/scripts/built_in_font/SourceHanSansSC-Normal.otf",
    );
  else {
    file = await realpath(path.resolve(root, font.file));
    if (!file.startsWith(root + path.sep) || path.isAbsolute(font.file))
      throw Error("Font leaves project root");
  }
  const output = path.join(dir, `lvp_font_${font.name}.c`);
  execFileSync(
    process.execPath,
    [
      converter,
      "--font",
      file,
      "--size",
      String(font.size),
      "--symbols",
      font.characters,
      "--bpp",
      "4",
      "--format",
      "lvgl",
      "--no-compress",
      "-o",
      output,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  sources.push(output);
}
const output = path.join(dir, "register.c");
await writeFile(
  output + ".tmp",
  '#include "lvgl.h"\n#include "lvglplus_ui.h"\n' +
    fonts.map((f) => `LV_FONT_DECLARE(lvp_font_${f.name});`).join("\n") +
    "\nvoid lvp_register_project_fonts(void){\n" +
    fonts
      .map((f) => `lvp_ui_register_font("${f.name}",&lvp_font_${f.name});`)
      .join("\n") +
    "\n}\n",
);
await rename(output + ".tmp", output);
sources.push(output);
console.log(JSON.stringify(sources));
