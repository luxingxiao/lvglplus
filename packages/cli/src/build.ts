import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
  repositoryRoot,
  inside,
  generateProject,
  validateValue,
  type LoadedProject,
} from "./project.js";

export async function run(
  command: string,
  args: string[],
  cwd = repositoryRoot,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let out = "",
      err = "";
    child.stdout.on("data", (data) => {
      out += data;
    });
    child.stderr.on("data", (data) => {
      err += data;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `${command} failed (${code})\n${err.slice(-6000)}\n${out.slice(-6000)}`,
            ),
          ),
    );
  });
}
export function pythonPath() {
  return path.join(
    repositoryRoot,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}
export async function generateDBC(project: LoadedProject, dir: string) {
  if (!project.sources.dbc || !project.manifest.sources) return;
  await run(pythonPath(), [
    path.join(repositoryRoot, "scripts/dbc_codegen.py"),
    await inside(project.root, project.sources.dbc),
    await inside(project.root, project.manifest.sources),
    dir,
  ]);
}
export async function buildNative(
  project: LoadedProject,
  generated = false,
  target?: string,
): Promise<string> {
  const output = await generateProject(project, undefined, target);
  const fonts = JSON.parse(
    await run(process.execPath, [
      path.join(repositoryRoot, "scripts/prepare_fonts.mjs"),
      project.root,
    ]),
  ) as string[];
  const buildDir = generated
    ? path.join(project.root, ".lvglplus/native-generated")
    : path.join(repositoryRoot, "build/native");
  await run("cmake", [
    "-S",
    repositoryRoot,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=Debug",
    "-DBUILD_TESTING=OFF",
    `-DLVP_FONT_SOURCES=${fonts.join(";")}`,
    `-DLVP_CUSTOM_SOURCES=${(
      await Promise.all(
        (project.manifest.native?.sources ?? []).map(async (name) => {
          if (!/\.(c|cc|cpp)$/.test(name) || name.includes(";"))
            throw Error("Invalid custom C source");
          return inside(project.root, name);
        }),
      )
    ).join(";")}`,
    ...(generated
      ? [`-DLVP_UI_DIR=${output}`, `-DLVP_UI_NAME=${project.ir.name}`]
      : ["-DLVP_UI_DIR="]),
  ]);
  await run("cmake", [
    "--build",
    buildDir,
    "--target",
    "lvp_runner",
    "--config",
    "Debug",
    "-j",
    "8",
  ]);
  return path.join(
    buildDir,
    process.platform === "win32" ? "Debug/lvp_runner.exe" : "lvp_runner",
  );
}
export async function buildGateway(project: LoadedProject): Promise<string> {
  if (process.platform !== "linux")
    throw new Error("SocketCAN gateway is supported on Linux only");
  const dir = path.join(project.root, ".lvglplus/dbc");
  await generateDBC(project, dir);
  if (!project.sources.dbc)
    throw new Error("Configure a DBC and mappings first");
  const buildDir = path.join(project.root, ".lvglplus/gateway");
  await run("cmake", [
    "-S",
    repositoryRoot,
    "-B",
    buildDir,
    "-DLVP_WITH_LVGL=OFF",
    "-DBUILD_TESTING=OFF",
    `-DLVP_DBC_DIR=${dir}`,
  ]);
  await run("cmake", [
    "--build",
    buildDir,
    "--target",
    "lvp_can_gateway",
    "-j",
    "4",
  ]);
  return path.join(buildDir, "lvp_can_gateway");
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name),
    len = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([len, type, data, checksum]);
}
export function ppmToPng(ppm: Buffer): Buffer {
  const header = /^P6\n(\d+) (\d+)\n255\n/.exec(
    ppm.subarray(0, 64).toString("ascii"),
  );
  if (!header) throw new Error("Invalid LVGL framebuffer output");
  const width = Number(header[1]),
    height = Number(header[2]),
    offset = header[0].length;
  if (ppm.length !== offset + width * height * 3)
    throw new Error("Truncated framebuffer");
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    ppm.copy(
      raw,
      y * (width * 3 + 1) + 1,
      offset + y * width * 3,
      offset + (y + 1) * width * 3,
    );
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export async function render(
  project: LoadedProject,
  options: {
    output: string;
    generated?: boolean;
    target?: string;
    atMs?: number;
    values?: Record<string, unknown>;
    binary?: string;
  },
) {
  const binary =
    options.binary ??
    (await buildNative(project, options.generated, options.target));
  const dir = path.join(project.root, ".lvglplus/results");
  await mkdir(dir, { recursive: true });
  const updates = path.join(dir, "updates.tsv"),
    ppm = path.join(dir, "frame.ppm"),
    tree = path.join(dir, "tree.tsv");
  const quality = ["valid", "stale", "invalid", "disconnected"];
  const lines = Object.entries(options.values ?? {}).map(([name, raw]) => {
    const s = project.ir.signals.find((s) => s.name === name);
    if (!s || s.derived) throw new Error(`Invalid input signal ${name}`);
    const value =
      typeof raw === "object" && raw !== null && "value" in raw
        ? (raw as { value: unknown }).value
        : raw;
    if (!validateValue(s.type, value, s.choices))
      throw new Error(`Invalid value for ${name}`);
    const q =
      typeof raw === "object" && raw !== null && "quality" in raw
        ? String((raw as { quality: unknown }).quality)
        : "valid";
    if (
      !quality.includes(q) ||
      (typeof value === "string" && /[\t\r\n]/.test(value))
    )
      throw new Error("Invalid update value/quality");
    return `${name}\t${typeof value === "boolean" ? Number(value) : String(value)}\t${quality.indexOf(q)}`;
  });
  await writeFile(updates, lines.join("\n") + (lines.length ? "\n" : ""));
  const output = await run(
    binary,
    [
      ...(!options.generated
        ? ["--package", path.join(project.root, ".lvglplus/generated/ui.lvp")]
        : []),
      "--updates",
      updates,
      "--out",
      ppm,
      "--tree",
      tree,
      "--at",
      String(options.atMs ?? 0),
    ],
    project.root,
  );
  const png = ppmToPng(await readFile(ppm));
  await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
  await writeFile(options.output, png);
  const values: Record<string, { value: number | string; quality: string }> =
    {};
  for (const line of output.trim().split("\n")) {
    const [name, n, q, text] = line.split("\t");
    if (!name) continue;
    const s = project.ir.signals.find((s) => s.name === name);
    if (s)
      values[name] = {
        value: s.type === "string" ? (text ?? "") : Number(n),
        quality: quality[Number(q)],
      };
  }
  return {
    png,
    values,
    tree: await readFile(tree, "utf8"),
    output: path.resolve(options.output),
  };
}
export async function doctor() {
  const probes: Record<string, string> = {
    node: process.version,
    platform: process.platform,
  };
  for (const cmd of ["cmake", "git", "python3"]) {
    try {
      probes[cmd] = (await run(cmd, ["--version"])).trim().split("\n")[0];
    } catch {
      probes[cmd] = "missing";
    }
  }
  for (const [name, p] of Object.entries({
    lvgl: ".deps/lvgl/lvgl.h",
    emscripten: ".deps/emsdk/upstream/emscripten/emcc.py",
    preview: "packages/studio/public/runtime/lvp.wasm",
    dbc: ".venv",
  })) {
    try {
      await access(path.join(repositoryRoot, p));
      probes[name] = "ready";
    } catch {
      if (name === "preview") {
        try {
          await access(
            path.join(repositoryRoot, "packages/studio/dist/runtime/lvp.wasm"),
          );
          probes[name] = "ready";
        } catch {
          probes[name] = "missing";
        }
      } else probes[name] = "missing";
    }
  }
  return probes;
}
