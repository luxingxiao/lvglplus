export const FORMAT_VERSION = 2;
export const PROJECT_VERSION = 1;
export type ValueType = "number" | "integer" | "boolean" | "string" | "enum";
export type Quality = "valid" | "stale" | "invalid" | "disconnected";
export interface Location {
  file: string;
  line: number;
  column: number;
}
export interface Diagnostic extends Location {
  code: string;
  message: string;
  severity: "error" | "warning";
}
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  loc: Location;
}
export interface Signal {
  name: string;
  type: ValueType;
  initial: number | string | boolean;
  unit: string;
  timeoutMs: number;
  derived?: Instruction[];
  format?: string;
  choices?: string[];
}
export type Op =
  | "const"
  | "load"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "mod"
  | "neg"
  | "not"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "and"
  | "or"
  | "select"
  | "jump_false"
  | "jump";
export interface Instruction {
  op: Op;
  value?: number;
  signal?: number;
}
export type WidgetKind =
  | "panel"
  | "text"
  | "button"
  | "bar"
  | "slider"
  | "arc"
  | "switch"
  | "image"
  | "custom";
export interface Binding {
  property: "text" | "value" | "checked" | "hidden" | "color" | "quality";
  signal: number;
  twoWay?: boolean;
  format?: string;
}
export interface UINode {
  id: string;
  kind: WidgetKind;
  props: Record<string, string>;
  bindings: Binding[];
  children: UINode[];
  command?: string;
  loc: Location;
}
export interface Target {
  name: string;
  width: number;
  height: number;
}
export interface Command {
  name: string;
  signal?: number;
  value?: number;
}
export interface ProjectManifest {
  formatVersion: number;
  name: string;
  ui: string;
  model: string;
  sources?: string;
  native?: { sources: string[] };
  lvglVersion: string;
  targets: Target[];
}
export interface ProjectIR {
  formatVersion: number;
  name: string;
  lvglVersion: string;
  targets: Target[];
  signals: Signal[];
  commands: Command[];
  pages: UINode[];
  initialPage: string;
  evaluationOrder: number[];
}
export interface CompileInput {
  manifest: ProjectManifest;
  ui: string;
  model: string;
  uiFile?: string;
  modelFile?: string;
}
export interface CompileResult {
  ir?: ProjectIR;
  diagnostics: Diagnostic[];
}
export interface DataEvent {
  signal: string;
  value: number | string | boolean;
  timestampMs: number;
  quality: Quality;
}
export interface ReplayRecord {
  atMs: number;
  qualities?: Record<string, Quality>;
  timestamps?: Record<string, number>;
  values: Record<string, number | string | boolean>;
}
export interface SourceConfig {
  adapters?: import("./types.js").AdapterSpec[];
  simulation?: Record<
    string,
    { min: number; max: number; periodMs: number; kind?: "sine" | "toggle" }
  >;
  replay?: string;
  dbc?: string;
  mappings?: Record<string, string>;
}

export interface AdapterSpec {
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
}
