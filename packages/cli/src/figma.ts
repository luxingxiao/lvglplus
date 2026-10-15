// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile, mkdir, cp, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { compile } from "@lvglplus/compiler";
import { inside } from "./project.js";
import { ownedOutput } from "./artifacts.js";
const xml = (v: unknown) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/\n/g, "&#10;");
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export async function importFigma(file: string, output: string) {
  const bytes = await readFile(file);
  if (bytes.length > 32 * 1024 * 1024)
    throw Error("Figma export exceeds 32 MiB");
  const data = JSON.parse(bytes.toString());
  if (data.format !== "lvglplus-figma" || data.version !== 1 || !data.frame)
    throw Error("Expected LVGL Plus Figma export v1");
  const generated = new Map<string, Buffer | string>(),
    signals = new Map<string, string>(),
    commands = new Set<string>();
  let count = 0;
  const convert = (node: any, root = false, depth = 0): string => {
    if (++count > 512 || depth > 32)
      throw Error("Figma document exceeds node limits");
    if (!/^[A-Za-z_]\w*$/.test(node.id)) throw Error("Invalid Figma node ID");
    const tag = root
      ? "page"
      : node.type === "TEXT"
        ? "text"
        : node.type === "IMAGE"
          ? "image"
          : node.command
            ? "button"
            : "panel";
    const props: Record<string, string> = { id: node.id };
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "bg",
      "color",
      "radius",
      "padding",
      "gap",
      "direction",
      "text",
      "src",
    ])
      if (node[key] !== undefined) props[key] = String(node[key]);
    if (node.fontSize)
      props.fontSize = String(
        [14, 20, 28, 40, 48].reduce((a, b) =>
          Math.abs(b - node.fontSize) < Math.abs(a - node.fontSize) ? b : a,
        ),
      );
    if (root) {
      delete props.x;
      delete props.y;
    }
    let children = "";
    if (node.signal) {
      if (!/^[A-Za-z_][\w.]*$/.test(node.signal))
        throw Error("Invalid signal annotation");
      signals.set(node.signal, "number");
      children += `<bind property="text" signal="${xml(node.signal)}"/>`;
      if (tag !== "text" && tag !== "button")
        throw Error("Signal annotations currently require text/button");
    }
    if (node.command) {
      if (!/^[A-Za-z_][\w.]*$/.test(node.command))
        throw Error("Invalid command annotation");
      commands.add(node.command);
      children += `<on event="click" command="${xml(node.command)}"/>`;
    }
    children += (node.children ?? [])
      .map((n: any) => convert(n, false, depth + 1))
      .join("\n");
    return `<${tag} ${Object.entries(props)
      .map(([k, v]) => `${k}="${xml(v)}"`)
      .join(" ")}>${children}</${tag}>`;
  };
  const ui = `<?xml version="1.0"?>\n<dashboard version="1">${convert(data.frame, true)}</dashboard>\n`,
    model = `<model version="1">${[...signals].map(([name, type]) => `<signal name="${name}" type="${type}"/>`).join("")}${[...commands].map((name) => `<command name="${name}"/>`).join("")}</model>\n`;
  const manifest = {
    formatVersion: 1,
    name: "figma_design",
    ui: "design.xml",
    model: "model.xml",
    lvglVersion: "9.5.0",
    targets: [
      { name: "design", width: data.frame.width, height: data.frame.height },
    ],
  };
  const result = compile({ manifest, ui, model });
  if (!result.ir)
    throw Error(result.diagnostics.map((d) => d.message).join("\n"));
  generated.set("design.xml", ui);
  generated.set("model.xml", model);
  generated.set("plus.project.json", JSON.stringify(manifest, null, 2) + "\n");
  let total = 0;
  for (const asset of data.assets ?? []) {
    if (
      !/^assets\/[A-Za-z_][\w-]*\.png$/.test(asset.path) ||
      generated.has(asset.path) ||
      !Array.isArray(asset.bytes) ||
      asset.bytes.some(
        (b: unknown) =>
          !Number.isInteger(b) || Number(b) < 0 || Number(b) > 255,
      )
    )
      throw Error("Invalid Figma asset");
    const b = Buffer.from(asset.bytes);
    if (
      b.length < 24 ||
      !b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (total += b.length) > 8 * 1024 * 1024
    )
      throw Error("Invalid PNG or resource budget");
    generated.set(asset.path, b);
  }
  let previous: Record<string, string> | undefined;
  try {
    previous = JSON.parse(
      await readFile(path.join(output, "design.lock.json"), "utf8"),
    ).files;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  for (const name of generated.keys()) {
    if (previous?.[name]) continue;
    try {
      await lstat(path.join(output, name));
      throw Error("Unowned file conflicts with import: " + name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  if (previous)
    for (const [name, hash] of Object.entries(previous)) {
      if (sha(await readFile(await inside(output, name))) !== hash)
        throw Error(
          `Generated file edited: ${name}; move your changes to extensions before reimport`,
        );
    }
  return ownedOutput(output, "figma", async (temp) => {
    if (previous) {
      await cp(output, temp, { recursive: true });
      for (const name of Object.keys(previous))
        await rm(await inside(temp, name), { force: true });
    }
    for (const [name, bytes] of generated) {
      const dest = path.join(temp, name);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(await inside(temp, name, false), bytes);
    }
    await rm(path.join(temp, "design.lock.json"), { force: true });
    await writeFile(
      path.join(temp, "design.lock.json"),
      JSON.stringify(
        {
          version: 1,
          files: Object.fromEntries(
            [...generated].map(([name, b]) => [name, sha(b)]),
          ),
          warnings: data.warnings ?? [],
        },
        null,
        2,
      ),
    );
  });
}
