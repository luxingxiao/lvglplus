import {
  realpath,
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
  stat,
  cp,
  mkdtemp,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { validateAdapter } from "./protocols.js";
import {
  compile,
  generateC,
  encodePackage,
  flatten,
  type ProjectManifest,
  type ProjectIR,
  type Diagnostic,
  type SourceConfig,
  type ValueType,
} from "@lvglplus/compiler";

const sourceRoot = path.resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
export const repositoryRoot = existsSync(
  path.join(sourceRoot, "sdk/include/lvglplus.h"),
)
  ? sourceRoot
  : path.resolve(fileURLToPath(new URL("../assets", import.meta.url)));
export class ProjectError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(
      diagnostics
        .map((d) => `${d.file}:${d.line}:${d.column} ${d.code} ${d.message}`)
        .join("\n"),
    );
  }
}
export async function inside(
  root: string,
  relative: string,
  mustExist = true,
): Promise<string> {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.includes("\0")
  )
    throw new Error("Expected a relative project path");
  const canonicalRoot = await realpath(root),
    resolved = path.resolve(canonicalRoot, relative);
  if (
    resolved !== canonicalRoot &&
    !resolved.startsWith(canonicalRoot + path.sep)
  )
    throw new Error("Path leaves project root");
  const canonical = mustExist
    ? await realpath(resolved)
    : path.join(
        await realpath(path.dirname(resolved)),
        path.basename(resolved),
      );
  if (
    canonical !== canonicalRoot &&
    !canonical.startsWith(canonicalRoot + path.sep)
  )
    throw new Error("Symlink leaves project root");
  return canonical;
}
export async function loadProject(folder: string) {
  const root = await realpath(folder);
  const manifest = JSON.parse(
    await readFile(await inside(root, "plus.project.json"), "utf8"),
  ) as ProjectManifest;
  if (
    !manifest ||
    typeof manifest.ui !== "string" ||
    typeof manifest.model !== "string"
  )
    throw new Error("Manifest requires ui and model paths");
  if (manifest.native) {
    const sources = manifest.native.sources;
    if (
      !Array.isArray(sources) ||
      sources.length > 32 ||
      sources.some(
        (name) =>
          typeof name !== "string" ||
          !/[.](c|cc|cpp)$/.test(name) ||
          name.includes(";"),
      )
    )
      throw new ProjectError([
        {
          file: "plus.project.json",
          line: 1,
          column: 1,
          severity: "error",
          code: "NATIVE",
          message: "native.sources must list at most 32 project C/C++ files",
        },
      ]);
    for (const source of sources) await inside(root, source);
  }
  const [ui, model] = await Promise.all([
    readFile(await inside(root, manifest.ui), "utf8"),
    readFile(await inside(root, manifest.model), "utf8"),
  ]);
  const result = compile({ manifest, ui, model });
  if (!result.ir) throw new ProjectError(result.diagnostics);
  let assetTotal = 0,
    decodedTotal = 0;
  for (const node of flatten(result.ir).filter(
    (node) => node.kind === "image" && node.props.src,
  )) {
    try {
      const filename = await inside(root, node.props.src.slice(2));
      const info = await stat(filename);
      if (
        !info.isFile() ||
        info.size > 2 * 1024 * 1024 ||
        (assetTotal += info.size) > 8 * 1024 * 1024
      )
        throw new Error("PNG asset exceeds the preview resource budget");
      const bytes = await readFile(filename);
      if (
        bytes.length < 24 ||
        (decodedTotal += bytes.readUInt32BE(16) * bytes.readUInt32BE(20) * 4) >
          64 * 1024 * 1024 ||
        bytes.readUInt32BE(16) < 1 ||
        bytes.readUInt32BE(20) < 1 ||
        bytes.readUInt32BE(16) > 4096 ||
        bytes.readUInt32BE(20) > 4096 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("Expected a PNG image");
    } catch (error) {
      throw new ProjectError([
        {
          ...node.loc,
          severity: "error",
          code: "RESOURCE",
          message: (error as Error).message,
        },
      ]);
    }
  }
  let sources: SourceConfig = {};
  if (manifest.sources)
    sources = JSON.parse(
      await readFile(await inside(root, manifest.sources), "utf8"),
    );
  validateSources(result.ir, sources);
  return {
    root,
    manifest,
    ui,
    model,
    ir: result.ir,
    sources,
    diagnostics: result.diagnostics,
  };
}
export type LoadedProject = Awaited<ReturnType<typeof loadProject>>;
export function validateValue(
  type: ValueType,
  value: unknown,
  choices?: string[],
): boolean {
  if (type === "string")
    return (
      typeof value === "string" && new TextEncoder().encode(value).length <= 255
    );
  if (type === "boolean")
    return typeof value === "boolean" || value === 0 || value === 1;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (type === "integer" || type === "enum") {
    if (!Number.isInteger(value) || Math.abs(value) > 2147483647) return false;
  }
  return type !== "enum" || (value >= 0 && value < (choices?.length ?? 0));
}
export function validateSources(ir: ProjectIR, sources: SourceConfig) {
  if (
    sources.adapters &&
    (!Array.isArray(sources.adapters) ||
      sources.adapters.length > 16 ||
      new Set(sources.adapters.map((c) => c.name)).size !==
        sources.adapters.length)
  )
    throw new Error("Adapters must have unique names (max 16)");
  for (const config of sources.adapters ?? []) validateAdapter(config, ir);
  for (const [name, spec] of Object.entries(sources.simulation ?? {})) {
    const signal = ir.signals.find((s) => s.name === name);
    if (
      !signal ||
      signal.derived ||
      signal.type === "string" ||
      ![spec.min, spec.max, spec.periodMs].every(Number.isFinite) ||
      spec.max < spec.min ||
      spec.periodMs < 20 ||
      (spec.kind && !["sine", "toggle"].includes(spec.kind))
    )
      throw new Error(`Invalid simulation source ${name}`);
    if (
      !validateValue(signal.type, spec.min, signal.choices) ||
      !validateValue(signal.type, spec.max, signal.choices)
    )
      throw new Error(`Simulation range does not match ${name}`);
  }
  for (const name of Object.values(sources.mappings ?? {})) {
    const signal = ir.signals.find((s) => s.name === name);
    if (!signal || signal.derived || signal.type === "string")
      throw new Error(`Invalid mapped signal ${name}`);
  }
}
export function selectTarget(ir: ProjectIR, name?: string) {
  const target = name ? ir.targets.find((t) => t.name === name) : ir.targets[0];
  if (!target) throw new Error(`Unknown target ${name}`);
  return target;
}
export async function generateProject(
  project: LoadedProject,
  output = path.join(project.root, ".lvglplus/generated"),
  targetName?: string,
) {
  const target = selectTarget(project.ir, targetName);
  let existed = false;
  try {
    await stat(output);
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existed) {
    try {
      const marker = JSON.parse(
        await readFile(path.join(output, ".lvglplus-generated"), "utf8"),
      );
      if (marker.generator !== "lvglplus") throw new Error();
    } catch {
      throw new Error(
        "Refusing to replace an unowned output directory. Choose a new dedicated directory.",
      );
    }
  }
  await mkdir(path.dirname(output), { recursive: true });
  const temp = await mkdtemp(output + ".tmp-");
  try {
    for (const [name, text] of Object.entries(generateC(project.ir, target)))
      await writeFile(path.join(temp, name), text);
    await writeFile(
      path.join(temp, "ui.lvp"),
      encodePackage(project.ir, target),
    );
    await writeFile(
      path.join(temp, ".lvglplus-generated"),
      JSON.stringify({ generator: "lvglplus", formatVersion: 1 }),
    );
    // Dedicated generated directory only. User files belong outside it.
    const backup = temp + ".previous";
    if (existed) await rename(output, backup);
    try {
      await rename(temp, output);
    } catch (e) {
      if (existed) await rename(backup, output);
      throw e;
    }
    await rm(backup, { recursive: true, force: true });
  } catch (e) {
    await rm(temp, { recursive: true, force: true });
    throw e;
  }
  return output;
}
export async function initProject(folder: string) {
  await mkdir(folder, { recursive: true });
  if ((await readdir(folder)).length)
    throw new Error("Initialization requires a new or empty directory");
  try {
    await stat(path.join(folder, "plus.project.json"));
    throw new Error("Project already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const template = path.join(repositoryRoot, "examples/vehicle");
  for (const entry of await readdir(template)) {
    if (entry === ".lvglplus") continue;
    await cp(path.join(template, entry), path.join(folder, entry), {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (name) => !name.split(path.sep).includes(".lvglplus"),
    });
  }
}
