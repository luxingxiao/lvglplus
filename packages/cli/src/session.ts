// SPDX-License-Identifier: Apache-2.0
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import { encodePackage, flatten } from "@lvglplus/compiler";
import {
  repositoryRoot,
  type LoadedProject,
  validateValue,
} from "./project.js";
import { projectAssets, runtimeDirectory } from "./artifacts.js";
import { ppmToPng } from "./build.js";
export class ModelSession {
  private m: any;
  private api: Record<string, (...args: any[]) => any> = {};
  now = 0;
  constructor(readonly project: LoadedProject) {}
  async open() {
    const { default: create } = await import(
      pathToFileURL(
        path.join(repositoryRoot, "packages/studio/dist/runtime/lvp.js"),
      ).href
    );
    this.m = await create({
      locateFile: (n: string) => path.join(runtimeDirectory(this.project), n),
      printErr: (message: string) => process.stderr.write(message + "\n"),
    });
    const types: Record<string, [string | null, string[]]> = {
      load: ["number", ["number", "number"]],
      error: ["string", []],
      tick: [null, ["number"]],
      pixels: ["number", []],
      width: ["number", []],
      height: ["number", []],
      number: ["number", ["number"]],
      text: ["string", ["number"]],
      quality: ["number", ["number"]],
      set: ["number", ["number", "number", "number", "number"]],
      set_text: ["number", ["number", "string", "number", "number"]],
      bounds: ["number", ["number", "number"]],
      locale: ["number", ["string"]],
      command: ["number", ["string"]],
      command_state: ["number", ["number"]],
      pointer: [null, ["number", "number", "number"]],
      close: [null, []],
    };
    for (const [name, [ret, args]] of Object.entries(types))
      this.api[name] = this.m.cwrap("lvp_preview_" + name, ret, args);
    for (const a of await projectAssets(this.project)) {
      const file = "/" + a.path;
      this.m.FS.mkdirTree(path.posix.dirname(file));
      this.m.FS.writeFile(file, Buffer.from(a.base64, "base64"));
    }
    const bytes = encodePackage(this.project.ir),
      p = this.m._malloc(bytes.length);
    try {
      this.m.HEAPU8.set(bytes, p);
      if (this.api.load(p, bytes.length)) throw Error(this.api.error());
    } finally {
      this.m._free(p);
    }
    this.tick(0);
    return this;
  }
  tick(now: number) {
    if (!Number.isFinite(now) || now < 0) throw Error("Invalid model time");
    this.now = now;
    this.api.tick(now);
  }
  read() {
    return this.project.ir.signals.map((s, i) => ({
      name: s.name,
      type: s.type,
      value:
        s.type === "string"
          ? this.api.text(i)
          : s.type === "boolean"
            ? Boolean(this.api.number(i))
            : this.api.number(i),
      quality: ["valid", "stale", "invalid", "disconnected"][
        this.api.quality(i)
      ],
      unit: s.unit,
    }));
  }
  write(name: string, value: unknown) {
    const i = this.project.ir.signals.findIndex((s) => s.name === name),
      s = this.project.ir.signals[i];
    if (!s || s.derived || !validateValue(s.type, value, s.choices))
      throw Error("Invalid writable signal/value");
    const result =
      s.type === "string"
        ? this.api.set_text(i, value, this.now, 0)
        : this.api.set(i, Number(value), this.now, 0);
    if (result) throw Error("Core rejected update: " + result);
    this.tick(this.now);
    return this.read();
  }
  inspect(id?: string) {
    return flatten(this.project.ir)
      .filter((n) => !id || n.id === id)
      .map((n) => {
        const index = flatten(this.project.ir).findIndex((x) => x.id === n.id),
          p = this.m._malloc(16);
        try {
          const result = this.api.bounds(index, p);
          return {
            ...n,
            bounds: result
              ? null
              : Array.from(this.m.HEAP32.subarray(p / 4, p / 4 + 4)),
          };
        } finally {
          this.m._free(p);
        }
      });
  }
  locale(name: string) {
    if (this.api.locale(name)) throw Error("Locale not found");
    this.tick(this.now);
  }
  command(name: string) {
    const id = this.api.command(name);
    if (id < 0) throw Error("Command not found or queue full");
    return {
      id,
      state: ["pending", "succeeded", "failed"][this.api.command_state(id)],
    };
  }
  pointer(x: number, y: number, pressed: boolean) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw Error("Invalid pointer");
    this.api.pointer(x, y, pressed ? 1 : 0);
    this.tick((this.now += 40));
  }
  png() {
    const width = this.api.width(),
      height = this.api.height(),
      p = this.api.pixels(),
      rgba = this.m.HEAPU8.subarray(p, p + width * height * 4),
      rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i + 2];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i];
    }
    return ppmToPng(
      Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]),
    );
  }
  async screenshot(file: string) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, this.png());
    return file;
  }
  close() {
    this.api.close?.();
  }
}
