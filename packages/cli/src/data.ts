import type {
  ProjectIR,
  SourceConfig,
  ReplayRecord,
  DataEvent,
} from "@lvglplus/compiler";
import { validateValue } from "./project.js";

export function parseReplay(text: string, ir: ProjectIR): ReplayRecord[] {
  const rows = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line, index) => {
      const row = JSON.parse(line) as ReplayRecord;
      if (
        !Number.isFinite(row.atMs) ||
        row.atMs < 0 ||
        !row.values ||
        typeof row.values !== "object" ||
        Array.isArray(row.values)
      )
        throw new Error(`Invalid replay record at line ${index + 1}`);
      for (const [name, value] of Object.entries(row.values)) {
        const signal = ir.signals.find((s) => s.name === name);
        if (
          !signal ||
          signal.derived ||
          !validateValue(signal.type, value, signal.choices)
        )
          throw new Error(`Invalid replay signal ${name} at line ${index + 1}`);
      }
      return row;
    });
  for (let i = 1; i < rows.length; i++)
    if (rows[i].atMs < rows[i - 1].atMs)
      throw new Error("Replay timestamps must be nondecreasing");
  return rows;
}
export class ReplayPlayer {
  positionMs = 0;
  speed = 1;
  paused = false;
  private cursor = 0;
  private wall: number | undefined;
  constructor(
    public records: ReplayRecord[],
    private ir: ProjectIR,
  ) {}
  seek(positionMs: number, now: number): DataEvent[] {
    if (!Number.isFinite(positionMs) || positionMs < 0)
      throw new Error("Seek must be nonnegative");
    this.positionMs = Math.min(positionMs, this.duration);
    this.cursor = 0;
    this.wall = now;
    const values: Record<string, number | string | boolean> =
      Object.fromEntries(
        this.ir.signals
          .filter((s) => !s.derived)
          .map((s) => [s.name, s.initial]),
      );
    const timestamps: Record<string, number> = {};
    while (
      this.cursor < this.records.length &&
      this.records[this.cursor].atMs <= this.positionMs
    ) {
      const row = this.records[this.cursor++];
      Object.assign(values, row.values);
      for (const signal of Object.keys(row.values))
        timestamps[signal] = row.atMs;
    }
    return Object.entries(values).map(([signal, value]) => ({
      signal,
      value,
      timestampMs: timestamps[signal] ?? 0,
      quality: "valid",
    }));
  }
  setSpeed(speed: number) {
    if (!Number.isFinite(speed) || speed < 0.1 || speed > 16)
      throw new Error("Replay speed must be 0.1..16");
    this.speed = speed;
  }
  advance(now: number): DataEvent[] {
    if (this.wall === undefined) return this.seek(0, now);
    if (!this.paused)
      this.positionMs = Math.min(
        this.duration,
        this.positionMs + Math.max(0, now - this.wall) * this.speed,
      );
    this.wall = now;
    const events: DataEvent[] = [];
    while (
      this.cursor < this.records.length &&
      this.records[this.cursor].atMs <= this.positionMs
    ) {
      const row = this.records[this.cursor++];
      for (const [signal, value] of Object.entries(row.values))
        events.push({ signal, value, timestampMs: row.atMs, quality: "valid" });
    }
    return events;
  }
  get duration() {
    return this.records.at(-1)?.atMs ?? 0;
  }
}
export function simulate(
  ir: ProjectIR,
  sources: SourceConfig,
  elapsed: number,
  now: number,
): DataEvent[] {
  return Object.entries(sources.simulation ?? {}).map(([signal, spec]) => {
    const def = ir.signals.find((s) => s.name === signal)!;
    const phase = (elapsed % spec.periodMs) / spec.periodMs;
    let value: number | boolean =
      spec.min +
      (spec.max - spec.min) *
        (spec.kind === "toggle"
          ? phase < 0.5
            ? 0
            : 1
          : (1 - Math.cos(phase * Math.PI * 2)) / 2);
    if (def.type === "boolean") value = value >= 0.5;
    if (def.type === "integer" || def.type === "enum")
      value = Math.round(Number(value));
    return { signal, value, timestampMs: now, quality: "valid" as const };
  });
}
