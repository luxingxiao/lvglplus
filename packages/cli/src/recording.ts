// SPDX-License-Identifier: Apache-2.0
import { open, type FileHandle } from "node:fs/promises";
import type { DataEvent } from "@lvglplus/compiler";
export class Recorder {
  private stopping = false;
  private file?: FileHandle;
  private pending = Promise.resolve();
  private queued = 0;
  private bytes = 0;
  private origin = 0;
  private last = 0;
  error = "";
  get active() {
    return !!this.file && !this.stopping;
  }
  async start(file: string, now: number) {
    if (this.file) throw Error("Recording already active");
    this.file = await open(file, "wx");
    this.stopping = false;
    this.origin = now;
    this.last = 0;
    this.bytes = 0;
    this.error = "";
  }
  enqueue(events: DataEvent[], now: number) {
    if (!this.active || this.error || !events.length) return;
    if (this.queued >= 128) {
      this.error = "Recording queue overflow";
      return;
    }
    const atMs = Math.max(this.last, now - this.origin);
    this.last = atMs;
    const row =
      JSON.stringify({
        atMs,
        values: Object.fromEntries(events.map((e) => [e.signal, e.value])),
        qualities: Object.fromEntries(events.map((e) => [e.signal, e.quality])),
        timestamps: Object.fromEntries(
          events.map((e) => [
            e.signal,
            Math.max(0, e.timestampMs - this.origin),
          ]),
        ),
      }) + "\n";
    if ((this.bytes += Buffer.byteLength(row)) > 64 * 1024 * 1024) {
      this.error = "Recording exceeds 64 MiB";
      return;
    }
    this.queued++;
    this.pending = this.pending
      .then(async () => {
        await this.file!.write(row);
      })
      .catch((e) => {
        this.error = e.message;
      })
      .finally(() => {
        this.queued--;
      });
  }
  async stop() {
    this.stopping = true;
    await this.pending;
    await this.file?.sync();
    await this.file?.close();
    this.file = undefined;
    return { bytes: this.bytes, error: this.error };
  }
}
