// SPDX-License-Identifier: Apache-2.0
import net from "node:net";
import { randomBytes } from "node:crypto";
import tls from "node:tls";
import dgram from "node:dgram";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { DataEvent, ProjectIR } from "@lvglplus/compiler";
import { validateValue } from "./project.js";
export type AdapterConfig = {
  name: string;
  kind: "tcp-json" | "udp-json" | "serial-json" | "mqtt" | "modbus-tcp";
  host?: string;
  port?: number;
  device?: string;
  baud?: number;
  topic?: string;
  tls?: boolean;
  mappings: Record<string, string>;
  unit?: number;
  address?: number;
  count?: number;
  pollMs?: number;
  registers?: Record<
    string,
    {
      offset: number;
      type: "uint16" | "int16" | "uint32" | "float32";
      factor?: number;
      offsetValue?: number;
    }
  >;
};
export function validateAdapter(c: AdapterConfig, ir: ProjectIR) {
  if (
    !c ||
    !/^\w[\w-]{0,31}$/.test(c.name) ||
    ["simulation", "replay", "manual", "can"].includes(c.name) ||
    !["tcp-json", "udp-json", "serial-json", "mqtt", "modbus-tcp"].includes(
      c.kind,
    ) ||
    !c.mappings ||
    typeof c.mappings !== "object"
  )
    throw Error("Invalid adapter definition");
  for (const [field, name] of Object.entries(c.mappings)) {
    const s = ir.signals.find((s) => s.name === name);
    if (!/^[A-Za-z_][\w.]*$/.test(field) || !s || s.derived)
      throw Error("Invalid adapter mapping " + field);
  }
  if (c.kind === "serial-json") {
    if (
      !c.device?.startsWith("/dev/") ||
      !Number.isInteger(c.baud) ||
      ![9600, 19200, 38400, 57600, 115200, 230400].includes(c.baud!)
    )
      throw Error("Serial requires /dev device and supported baud");
  } else if (
    typeof c.host !== "string" ||
    !c.host.length ||
    !Number.isInteger(c.port) ||
    c.port! < 1 ||
    c.port! > 65535
  )
    throw Error("Adapter requires host and port");
  if (
    c.kind === "mqtt" &&
    (!c.topic || /[+#\0]/.test(c.topic) || Buffer.byteLength(c.topic) > 256)
  )
    throw Error("MQTT requires a concrete topic (QoS 0)");
  if (c.kind === "modbus-tcp") {
    if (
      !Number.isInteger(c.address) ||
      c.address! < 0 ||
      c.address! > 65535 ||
      !Number.isInteger(c.count) ||
      c.count! < 1 ||
      c.count! > 125 ||
      c.address! + c.count! > 65536 ||
      !Number.isInteger(c.unit) ||
      c.unit! < 0 ||
      c.unit! > 255 ||
      (c.pollMs ?? 500) < 50 ||
      (c.pollMs ?? 500) > 60000
    )
      throw Error("Invalid Modbus request");
    for (const [field, r] of Object.entries(c.registers ?? {}))
      if (
        !c.mappings[field] ||
        !/^[A-Za-z_]\w*$/.test(field) ||
        !["uint16", "int16", "uint32", "float32"].includes(r.type) ||
        !Number.isInteger(r.offset) ||
        r.offset < 0 ||
        r.offset + (["uint32", "float32"].includes(r.type) ? 2 : 1) >
          c.count! ||
        !Number.isFinite(r.factor ?? 1) ||
        !Number.isFinite(r.offsetValue ?? 0)
      )
        throw Error("Invalid register " + field);
  }
}
export function mqttPacket(type: number, payload: Buffer) {
  let length = payload.length;
  const header = [type];
  do {
    let b = length % 128;
    length = Math.floor(length / 128);
    if (length) b |= 128;
    header.push(b);
  } while (length);
  return Buffer.concat([Buffer.from(header), payload]);
}
const mqttString = (s: string) => {
  const b = Buffer.from(s),
    h = Buffer.alloc(2);
  h.writeUInt16BE(b.length);
  return Buffer.concat([h, b]);
};
export class ProtocolAdapter {
  private socket?: net.Socket;
  private udp?: dgram.Socket;
  private serial?: FileHandle;
  private generation = 0;
  private retry?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private buffer: Buffer = Buffer.alloc(0);
  private pending = false;
  private transaction = 0;
  private expected = 0;
  private pendingAt = 0;
  private failures = 0;
  private queue: DataEvent[] = [];
  stats = { received: 0, decoded: 0, errors: 0, overflow: 0, reconnects: 0 };
  constructor(
    readonly config: AdapterConfig,
    readonly ir: ProjectIR,
    private state: (connected: boolean, error: string) => void = () => {},
  ) {
    validateAdapter(config, ir);
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.retry);
    clearInterval(this.timer);
    this.socket?.destroy();
    this.udp?.close();
    void this.serial?.close().catch(() => {});
    this.socket = undefined;
    this.udp = undefined;
    this.serial = undefined;
    this.buffer = Buffer.alloc(0);
    this.queue = [];
    this.state(false, "Stopped");
  }
  drain() {
    return this.queue.splice(0);
  }
  private fail(error: unknown) {
    if (this.stopped) return;
    this.stats.errors++;
    this.state(false, (error as Error).message ?? String(error));
    this.socket?.destroy();
    void this.serial?.close().catch(() => {});
    this.serial = undefined;
    if (this.retry) return;
    clearInterval(this.timer);
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        this.stats.reconnects++;
        this.connect();
      },
      Math.min(500 * 2 ** this.failures++, 5000),
    );
  }
  private publish(object: unknown) {
    if (this.stopped) return;
    this.stats.received++;
    const values: DataEvent[] = [];
    for (const [field, signal] of Object.entries(this.config.mappings)) {
      let value: any = object;
      for (const key of field.split(".")) {
        if (
          value === null ||
          typeof value !== "object" ||
          !Object.hasOwn(value, key)
        ) {
          value = undefined;
          break;
        }
        value = value[key];
      }
      const def = this.ir.signals.find((s) => s.name === signal)!;
      if (!validateValue(def.type, value, def.choices)) {
        this.stats.errors++;
        const previous = [...this.queue]
          .reverse()
          .find((e) => e.signal === signal);
        values.push({
          signal,
          value: previous?.value ?? def.initial,
          timestampMs: Date.now(),
          quality: "invalid",
        });
      } else
        values.push({
          signal,
          value,
          timestampMs: Date.now(),
          quality: "valid",
        });
    }
    for (const event of values) {
      if (this.queue.length === 256) {
        this.stats.overflow++;
        this.state(true, "Ingress overflow");
        break;
      }
      this.queue.push(event);
      this.stats.decoded++;
    }
  }
  private lines(bytes: Buffer) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > 65536) throw Error("JSON frame exceeds 64 KiB");
    let end;
    while ((end = this.buffer.indexOf(10)) >= 0) {
      const line = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 1);
      if (line.trim()) this.publish(JSON.parse(line));
    }
  }
  private connected() {
    this.failures = 0;
    this.pending = false;
    this.state(true, "");
  }
  private connect() {
    if (this.stopped) return;
    this.buffer = Buffer.alloc(0);
    this.pending = false;
    const c = this.config;
    const generation = ++this.generation;
    if (c.kind === "serial-json") {
      try {
        if (process.platform === "win32")
          throw Error("serial-json requires POSIX termios");
        execFileSync(
          "stty",
          [
            process.platform === "darwin" ? "-f" : "-F",
            c.device!,
            String(c.baud),
            "raw",
            "-echo",
            "-ixon",
            "-ixoff",
          ],
          { timeout: 3000, stdio: "pipe" },
        );
        void open(c.device!, constants.O_RDONLY | constants.O_NONBLOCK)
          .then((file) => {
            if (this.stopped || generation !== this.generation) {
              void file.close();
              return;
            }
            this.serial = file;
            this.connected();
            let reading = false;
            this.timer = setInterval(() => {
              if (reading || this.stopped) return;
              reading = true;
              const buffer = Buffer.alloc(4096);
              void file
                .read(buffer, 0, buffer.length, null)
                .then(({ bytesRead }) => {
                  if (this.stopped || generation !== this.generation) return;
                  if (bytesRead) this.lines(buffer.subarray(0, bytesRead));
                })
                .catch((e) => {
                  if (
                    e.code !== "EAGAIN" &&
                    e.code !== "EWOULDBLOCK" &&
                    !this.stopped &&
                    generation === this.generation
                  )
                    this.fail(e);
                })
                .finally(() => {
                  reading = false;
                });
            }, 10);
          })
          .catch((e) => {
            if (!this.stopped && generation === this.generation) this.fail(e);
          });
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    if (c.kind === "udp-json") {
      try {
        this.udp = dgram.createSocket("udp4");
        this.udp.on("message", (b) => {
          try {
            if (b.length > 65507) throw Error("Oversized UDP");
            this.publish(JSON.parse(b.toString("utf8")));
          } catch (e) {
            this.stats.errors++;
            this.state(true, (e as Error).message);
          }
        });
        this.udp.on("error", (e) => {
          this.udp?.close();
          this.udp = undefined;
          this.fail(e);
        });
        this.udp.bind(c.port, c.host, () => this.connected());
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    const socket = c.tls
      ? tls.connect({ host: c.host, port: c.port!, rejectUnauthorized: true })
      : net.createConnection({ host: c.host, port: c.port! });
    this.socket = socket;
    socket.setTimeout(10000, () => this.fail(Error("Transport timeout")));
    socket.on(c.tls ? "secureConnect" : "connect", () => {
      if (c.kind === "mqtt") {
        const connect = Buffer.concat([
          mqttString("MQTT"),
          Buffer.from([4, 2, 0, 20]),
          mqttString("lvglplus-" + randomBytes(6).toString("hex")),
        ]);
        socket.write(mqttPacket(0x10, connect));
        this.timer = setInterval(
          () => socket.write(Buffer.from([0xc0, 0])),
          5000,
        );
      } else {
        this.connected();
        if (c.kind === "modbus-tcp") {
          this.poll();
          this.timer = setInterval(() => this.poll(), c.pollMs ?? 500);
        }
      }
    });
    socket.on("data", (bytes) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        if (c.kind === "tcp-json") this.lines(bytes);
        else {
          this.buffer = Buffer.concat([this.buffer, bytes]);
          if (this.buffer.length > 65536) throw Error("Protocol buffer limit");
          if (c.kind === "mqtt") this.mqtt();
          else this.modbus();
        }
      } catch (e) {
        this.fail(e);
      }
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => {
      if (this.socket === socket) this.fail(Error("Transport disconnected"));
    });
  }
  private poll() {
    if (this.pending) {
      if (Date.now() - this.pendingAt > 2000)
        this.fail(Error("Modbus response timeout"));
      return;
    }
    const b = Buffer.alloc(12);
    this.expected = ++this.transaction & 65535;
    b.writeUInt16BE(this.expected, 0);
    b.writeUInt16BE(6, 4);
    b[6] = this.config.unit!;
    b[7] = 3;
    b.writeUInt16BE(this.config.address!, 8);
    b.writeUInt16BE(this.config.count!, 10);
    this.pending = true;
    this.pendingAt = Date.now();
    this.socket?.write(b);
  }
  private modbus() {
    while (this.buffer.length >= 7) {
      const n = this.buffer.readUInt16BE(4);
      if (n < 3 || n > 254 || this.buffer.readUInt16BE(2) !== 0)
        throw Error("Invalid Modbus MBAP");
      if (this.buffer.length < n + 6) return;
      const b = this.buffer.subarray(0, n + 6);
      this.buffer = this.buffer.subarray(n + 6);
      if (
        !this.pending ||
        b.readUInt16BE(0) !== this.expected ||
        b[6] !== this.config.unit
      )
        throw Error("Unexpected Modbus transaction");
      this.pending = false;
      if (
        b[7] !== 3 ||
        b[8] !== this.config.count! * 2 ||
        b.length !== 9 + b[8]
      )
        throw Error("Modbus exception or invalid register count");
      const values: Record<string, number> = {};
      for (const [field, r] of Object.entries(this.config.registers ?? {})) {
        const offset = 9 + r.offset * 2;
        const raw =
          r.type === "int16"
            ? b.readInt16BE(offset)
            : r.type === "uint32"
              ? b.readUInt32BE(offset)
              : r.type === "float32"
                ? b.readFloatBE(offset)
                : b.readUInt16BE(offset);
        values[field] = raw * (r.factor ?? 1) + (r.offsetValue ?? 0);
      }
      this.publish(values);
    }
  }
  private mqtt() {
    while (this.buffer.length >= 2) {
      let n = 0,
        mul = 1,
        i = 1;
      for (;;) {
        if (i >= this.buffer.length) return;
        const b = this.buffer[i++];
        n += (b & 127) * mul;
        if (!(b & 128)) break;
        if (i > 4) throw Error("Malformed MQTT remaining length");
        mul *= 128;
      }
      if (n > 65532) throw Error("MQTT frame limit");
      if (this.buffer.length < i + n) return;
      const type = this.buffer[0],
        p = this.buffer.subarray(i, i + n);
      this.buffer = this.buffer.subarray(i + n);
      if (type === 0x20) {
        if (p.length !== 2 || p[1] !== 0)
          throw Error("MQTT connection refused");
        this.connected();
        this.socket?.write(
          mqttPacket(
            0x82,
            Buffer.concat([
              Buffer.from([0, 1]),
              mqttString(this.config.topic!),
              Buffer.from([0]),
            ]),
          ),
        );
      } else if (type >> 4 === 3) {
        if ((type & 6) !== 0) throw Error("Only MQTT QoS 0 is supported");
        if (p.length < 2) throw Error("Truncated MQTT topic");
        const len = p.readUInt16BE(0);
        if (2 + len > p.length) throw Error("Truncated MQTT publish");
        if (p.toString("utf8", 2, 2 + len) === this.config.topic)
          this.publish(JSON.parse(p.subarray(2 + len).toString("utf8")));
      } else if (type === 0x90) {
        if (p.length < 3 || p[2] === 0x80)
          throw Error("MQTT subscription rejected");
      }
    }
  }
}
