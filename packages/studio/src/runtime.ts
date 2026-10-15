export interface SignalSnapshot {
  name: string;
  type: number;
  value: string | number;
  quality: number;
}
// Thin bridge only: state evaluation and rendering live in the shared C/WASM core.
export class PreviewRuntime {
  module: any;
  private calls: Record<string, (...args: any[]) => any> = {};
  async initialize() {
    const url = "/runtime/lvp.js";
    const { default: createRuntime } = await import(/* @vite-ignore */ url);
    this.module = await createRuntime({
      locateFile: (name: string) => "/runtime/" + name,
    });
    const signatures: Record<string, [string | null, string[]]> = {
      load: ["number", ["number", "number"]],
      tick: [null, ["number"]],
      pixels: ["number", []],
      width: ["number", []],
      height: ["number", []],
      error: ["string", []],
      signal_count: ["number", []],
      signal_name: ["string", ["number"]],
      signal_type: ["number", ["number"]],
      number: ["number", ["number"]],
      text: ["string", ["number"]],
      quality: ["number", ["number"]],
      set: ["number", ["number", "number", "number", "number"]],
      set_text: ["number", ["number", "string", "number", "number"]],
      begin: [null, []],
      end: [null, []],
      disconnect: [null, ["number"]],
      pointer: [null, ["number", "number", "number"]],
      command: ["number", ["string"]],
      command_state: ["number", ["number"]],
      bounds: ["number", ["number", "number"]],
      close: [null, []],
    };
    for (const [name, [ret, args]] of Object.entries(signatures))
      this.calls[name] = this.module.cwrap("lvp_preview_" + name, ret, args);
  }
  load(bytes: Uint8Array) {
    const ptr = this.module._malloc(bytes.length);
    if (!ptr) throw new Error("WASM allocation failed");
    try {
      this.module.HEAPU8.set(bytes, ptr);
      if (this.calls.load(ptr, bytes.length) !== 0)
        throw new Error(this.calls.error());
    } finally {
      this.module._free(ptr);
    }
  }
  assets(files: { path: string; base64: string }[]) {
    for (const file of files) {
      if (file.path.split("/").includes("..") || file.path.startsWith("/"))
        throw new Error("Invalid asset path");
      const name = "/" + file.path,
        parent = name.slice(0, name.lastIndexOf("/")) || "/";
      this.module.FS.mkdirTree(parent);
      const raw = atob(file.base64);
      this.module.FS.writeFile(
        name,
        Uint8Array.from(raw, (c) => c.charCodeAt(0)),
      );
    }
  }
  tick(time: number) {
    this.calls.tick(time);
  }
  get width() {
    return this.calls.width();
  }
  get height() {
    return this.calls.height();
  }
  paint(context: CanvasRenderingContext2D, image: ImageData) {
    const ptr = this.calls.pixels(),
      bytes = this.module.HEAPU8;
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = bytes[ptr + i + 2];
      image.data[i + 1] = bytes[ptr + i + 1];
      image.data[i + 2] = bytes[ptr + i];
      image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }
  signals(): SignalSnapshot[] {
    return Array.from({ length: this.calls.signal_count() }, (_, i) => ({
      name: this.calls.signal_name(i),
      type: this.calls.signal_type(i),
      value:
        this.calls.signal_type(i) === 3
          ? this.calls.text(i)
          : this.calls.number(i),
      quality: this.calls.quality(i),
    }));
  }
  update(
    events: {
      signal: string;
      value: string | number | boolean;
      timestampMs: number;
      quality: string;
    }[],
  ) {
    const names = Array.from({ length: this.calls.signal_count() }, (_, i) =>
      this.calls.signal_name(i),
    );
    this.calls.begin();
    try {
      for (const event of events) {
        const i = names.indexOf(event.signal);
        if (i < 0) continue;
        const q = ["valid", "stale", "invalid", "disconnected"].indexOf(
          event.quality,
        );
        if (q < 0) continue;
        const result =
          typeof event.value === "string"
            ? this.calls.set_text(i, event.value, event.timestampMs, q)
            : this.calls.set(i, Number(event.value), event.timestampMs, q);
        if (result !== 0)
          throw new Error(`Model rejected ${event.signal}: ${result}`);
      }
    } finally {
      this.calls.end();
    }
  }
  pointer(x: number, y: number, pressed: boolean) {
    this.calls.pointer(Math.round(x), Math.round(y), pressed ? 1 : 0);
  }
  bounds(index: number) {
    const ptr = this.module._malloc(16);
    try {
      if (this.calls.bounds(index, ptr) !== 0) return undefined;
      return Array.from(
        this.module.HEAP32.subarray(ptr / 4, ptr / 4 + 4),
      ) as number[];
    } finally {
      this.module._free(ptr);
    }
  }
  close() {
    this.calls.close?.();
  }
}
