// SPDX-License-Identifier: Apache-2.0
// Compile-time bounded expansion. Runtime data remains typed scalar slots, never JSON blobs.
import { compileExpression } from "./expression.js";
import type { XmlNode, Program, Signal, Command } from "./types.js";
type ErrorFn = (node: XmlNode, code: string, message: string) => void;
export function lowerDeclarative(model: XmlNode, ui: XmlNode, error: ErrorFn) {
  const actions: XmlNode[] = [],
    clocks: XmlNode[] = [],
    timers: XmlNode[] = [];
  const collections = new Map<string, number>();
  const definitions = new Map<string, XmlNode>();
  const snapshots: XmlNode[] = [];
  let budget = 0;
  function substitute(n: XmlNode, values: Record<string, string>): XmlNode {
    return {
      ...n,
      attrs: Object.fromEntries(
        Object.entries(n.attrs).map(([k, v]) => [
          k,
          v.replace(/\$\{([\w.]+)\}/g, (m, key) => values[key] ?? m),
        ]),
      ),
      children: n.children.map((c) => substitute(c, values)),
    };
  }
  function check(n: XmlNode, keys: string[]) {
    for (const k of Object.keys(n.attrs))
      if (!keys.includes(k))
        error(n, "ATTRIBUTE", `Unknown ${n.tag} attribute ${k}`);
  }
  const children: XmlNode[] = [];
  const addSignal = (
    n: XmlNode,
    name: string,
    type: string,
    initial: string,
    choices?: string,
  ) =>
    children.push({
      ...n,
      tag: "signal",
      attrs: { name, type, initial, ...(choices ? { choices } : {}) },
      children: [],
    });
  for (const n of model.children) {
    if (n.tag === "collection") {
      check(n, ["name", "capacity"]);
      const cap = Number(n.attrs.capacity),
        name = n.attrs.name;
      if (
        !/^[A-Za-z_]\w*$/.test(name ?? "") ||
        collections.has(name) ||
        !Number.isInteger(cap) ||
        cap < 1 ||
        cap > 64
      ) {
        error(
          n,
          "COLLECTION",
          "Expected unique collection name and capacity 1..64",
        );
        continue;
      }
      collections.set(name, cap);
      definitions.set(name, n);
      for (const field of n.children)
        if (
          !["field", "computed"].includes(field.tag) ||
          !/^[A-Za-z_]\w*$/.test(field.attrs.name ?? "")
        )
          error(field, "COLLECTION_FIELD", "Expected named field or computed");
      if (cap * n.children.length > 256) {
        error(n, "SIGNAL_LIMIT", "Expanded collection exceeds 256 signals");
        continue;
      }
      for (let i = 0; i < cap; i++)
        for (const f of n.children) {
          const v = substitute(f, { index: String(i) });
          children.push({
            ...v,
            tag: f.tag === "field" ? "signal" : "computed",
            attrs: { ...v.attrs, name: `${name}.${i}.${f.attrs.name}` },
          });
        }
    } else if (n.tag === "snapshot") {
      snapshots.push(n);
    } else if (n.tag === "action") {
      check(n, ["name", "guard", "parameter"]);
      actions.push(n);
    } else if (n.tag === "machine") {
      check(n, ["name", "initial"]);
      const names = n.children.map((s) => s.attrs.name),
        name = n.attrs.name;
      if (
        !/^[A-Za-z_]\w*$/.test(name ?? "") ||
        !names.length ||
        names.length > 32 ||
        new Set(names).size !== names.length ||
        names.some((x) => !/^[A-Za-z_]\w*$/.test(x ?? "")) ||
        !names.includes(n.attrs.initial)
      ) {
        error(n, "MACHINE", "Invalid states or initial state");
        continue;
      }
      addSignal(
        n,
        `state.${name}`,
        "enum",
        String(names.indexOf(n.attrs.initial)),
        names.join("|"),
      );
      for (const [i, state] of n.children.entries()) {
        check(state, ["name"]);
        if (state.tag !== "state") error(state, "MACHINE", "Expected state");
        const events = new Set<string>();
        for (const on of state.children) {
          check(on, ["event", "target", "guard"]);
          if (
            on.tag !== "on" ||
            !names.includes(on.attrs.target) ||
            events.has(on.attrs.event)
          ) {
            error(on, "TRANSITION", "Expected unique event and valid target");
            continue;
          }
          events.add(on.attrs.event);
          actions.push({
            ...on,
            tag: "action",
            attrs: {
              name: on.attrs.event,
              guard: `state.${name} == ${i} && (${on.attrs.guard ?? "true"})`,
            },
            children: [
              {
                ...on,
                tag: "set",
                attrs: {
                  target: `state.${name}`,
                  expression: String(names.indexOf(on.attrs.target)),
                },
                children: [],
              },
              ...on.children,
            ],
          });
        }
      }
    } else if (n.tag === "clock") {
      check(n, ["name", "running", "rate"]);
      clocks.push(n);
      addSignal(n, `${n.attrs.name}.ms`, "number", "0");
    } else if (n.tag === "timer") {
      check(n, ["clock", "intervalMs", "command"]);
      timers.push(n);
    } else children.push(n);
  }
  for (const n of snapshots) {
    check(n, ["name", "collection", "fields", "clock", "intervalMs"]);
    const definition = definitions.get(n.attrs.collection),
      cap = collections.get(n.attrs.collection),
      name = n.attrs.name;
    if (
      !definition ||
      !cap ||
      !/^[A-Za-z_]\w*$/.test(name ?? "") ||
      collections.has(name)
    ) {
      error(
        n,
        "SNAPSHOT",
        "Expected unique snapshot name and source collection",
      );
      continue;
    }
    const fields = (n.attrs.fields ?? "").split(",");
    const sets: XmlNode[] = [];
    for (const field of fields) {
      const source = definition.children.find((f) => f.attrs.name === field);
      if (!source || source.attrs.type === "string") {
        error(n, "SNAPSHOT", "Snapshot fields must exist and be numeric");
        continue;
      }
      for (let i = 0; i < cap; i++) {
        const initial = (source.attrs.initial ?? "0").replaceAll(
          "${index}",
          String(i),
        );
        const type = source.attrs.type ?? "number";
        addSignal(
          n,
          `${name}.${i}.${field}`,
          type,
          type === "boolean" ? "false" : initial,
          source.attrs.choices,
        );
        sets.push({
          ...n,
          tag: "set",
          attrs: {
            target: `${name}.${i}.${field}`,
            expression: `${n.attrs.collection}.${i}.${field}`,
          },
          children: [],
        });
      }
    }
    collections.set(name, cap);
    addSignal(n, `${name}.sequence`, "integer", "0");
    sets.push({
      ...n,
      tag: "set",
      attrs: { target: `${name}.sequence`, expression: `${name}.sequence+1` },
      children: [],
    });
    actions.push({
      ...n,
      tag: "action",
      attrs: { name: `snapshot.${name}` },
      children: sets,
    });
    timers.push({
      ...n,
      tag: "timer",
      attrs: {
        clock: n.attrs.clock,
        intervalMs: n.attrs.intervalMs,
        command: `snapshot.${name}`,
      },
      children: [],
    });
  }
  // Every declared action is callable through the ordinary public command contract.
  const existing = new Set(
    children.filter((n) => n.tag === "command").map((n) => n.attrs.name),
  );
  for (const n of actions)
    if (!existing.has(n.attrs.name)) {
      children.push({
        ...n,
        tag: "command",
        attrs: { name: n.attrs.name },
        children: [],
      });
      existing.add(n.attrs.name);
    }
  model.children = children;
  function expand(n: XmlNode, depth = 0): XmlNode[] {
    if (++budget > 12000 || depth > 32) {
      error(n, "EXPANSION_LIMIT", "Declaration expansion budget exceeded");
      return [];
    }
    if (n.tag === "repeat") {
      check(n, ["collection", "count", "id"]);
      const cap = n.attrs.collection
        ? collections.get(n.attrs.collection)
        : Number(n.attrs.count);
      if (!Number.isInteger(cap) || !cap || cap < 1 || cap > 64) {
        error(n, "REPEAT", "Expected declared collection or count 1..64");
        return [];
      }
      const out: XmlNode[] = [];
      for (let i = 0; i < cap; i++)
        for (const child of n.children) {
          let copy = substitute(child, { index: String(i) });
          const rewrite = (x: XmlNode): XmlNode => ({
            ...x,
            attrs: Object.fromEntries(
              Object.entries(x.attrs).map(([k, v]) => [
                k,
                (k === "id"
                  ? `${n.attrs.id ?? n.attrs.collection ?? "repeat"}.${i}.`
                  : "") +
                  v.replace(
                    /\$\{item\.([A-Za-z_]\w*)\}/g,
                    (_, f) => `${n.attrs.collection}.${i}.${f}`,
                  ),
              ]),
            ),
            children: x.children.map(rewrite),
          });
          copy = rewrite(copy);
          if (!copy.attrs.id)
            copy.attrs.id = `${n.attrs.id ?? n.attrs.collection ?? "repeat"}.${i}.${copy.tag}`;
          out.push(...expand(copy, depth + 1));
        }
      return out;
    }
    return [
      { ...n, children: n.children.flatMap((c) => expand(c, depth + 1)) },
    ];
  }
  ui.children = ui.children.flatMap((n) => expand(n));
  // Inline numeric bindings lower to private computed signals; same bytecode in every target.
  let index = 0;
  const bindings = (n: XmlNode) => {
    if (n.tag === "bind" && n.attrs.expression !== undefined) {
      if (n.attrs.signal) error(n, "BIND", "Use expression or signal");
      const name = `_binding.${index++}`;
      model.children.push({
        ...n,
        tag: "computed",
        attrs: { name, type: "number", expression: n.attrs.expression },
        children: [],
      });
      n.attrs.signal = name;
      delete n.attrs.expression;
    }
    n.children.forEach(bindings);
  };
  bindings(ui);
  const reductions = (n: XmlNode) => {
    if (n.attrs.expression)
      n.attrs.expression = n.attrs.expression
        .replace(
          /\bat\(([A-Za-z_]\w*)\.([A-Za-z_]\w*),\s*([A-Za-z_][\w.]*|\d+)\)/g,
          (_, name, field, index) => {
            const cap = collections.get(name);
            if (!cap) {
              error(n, "COLLECTION", "Unknown lookup collection");
              return "0";
            }
            const tree = (lo: number, hi: number): string => {
              if (hi - lo === 1) return `${name}.${lo}.${field}`;
              const mid = Math.floor((lo + hi) / 2);
              return `(${index}<${mid}?${tree(lo, mid)}:${tree(mid, hi)})`;
            };
            return `(${index}>=0 && ${index}<${cap} && floor(${index})==${index} ? ${tree(0, cap)} : 1/0)`;
          },
        )
        .replace(
          /\bfitScale\(([A-Za-z_]\w*),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\)/g,
          (_, name, w, h, lo, hi, pad) => {
            const cap = collections.get(name);
            if (!cap) {
              error(n, "COLLECTION", "Unknown fitScale collection");
              return "0";
            }
            return `fitScale(${w},${h},${lo},${hi},${pad},${Array.from({ length: cap }, (_, i) => `${name}.${i}.x,${name}.${i}.y`).join(",")})`;
          },
        )
        .replace(
          /\b(clusterId|clusterSize|clusterX|clusterY)\(([A-Za-z_]\w*),\s*(\d+),\s*([0-9.]+)\)/g,
          (_, op, name, index, radius) => {
            const cap = collections.get(name);
            if (!cap || Number(index) >= cap) {
              error(n, "COLLECTION", "Invalid cluster collection/index");
              return "0";
            }
            return `${op}(${index},${radius},${Array.from({ length: cap }, (_, i) => `${name}.${i}.x,${name}.${i}.y`).join(",")})`;
          },
        )
        .replace(
          /\b(sum|minimum|maximum)\(([A-Za-z_]\w*)\.([A-Za-z_]\w*)\)/g,
          (_, op, name, field) => {
            const cap = collections.get(name);
            if (!cap) {
              error(n, "COLLECTION", `Unknown collection ${name}`);
              return "0";
            }
            const terms = Array.from(
              { length: cap },
              (_, i) => `${name}.${i}.${field}`,
            );
            return op === "sum"
              ? `(${terms.join("+")})`
              : terms
                  .slice(1)
                  .reduce(
                    (a, b) => `${op === "minimum" ? "min" : "max"}(${a},${b})`,
                    terms[0],
                  );
          },
        );
    n.children.forEach(reductions);
  };
  reductions(model);
  actions.forEach(reductions);

  return { actions, clocks, timers };
}
export function compileProgram(
  source: ReturnType<typeof lowerDeclarative>,
  signals: Signal[],
  commands: Command[],
  error: ErrorFn,
): Program {
  const program: Program = { actions: [], clocks: [], timers: [] };
  const index = (n: XmlNode, name: string, writable = false) => {
    const i = signals.findIndex((s) => s.name === name);
    if (
      i < 0 ||
      signals[i].type === "string" ||
      (writable && signals[i].derived)
    )
      error(n, "PROGRAM_SIGNAL", `Invalid numeric signal ${name}`);
    return i;
  };
  const expr = (n: XmlNode, text: string, argument = false) => {
    try {
      return compileExpression(text, signals, argument);
    } catch (e) {
      error(n, "EXPRESSION", (e as Error).message);
      return [];
    }
  };
  const signatures = new Map<string, number>();
  for (const n of source.actions) {
    if (!/^[A-Za-z_][\w.]*$/.test(n.attrs.name ?? ""))
      error(n, "ACTION", "Invalid action name");
    const parameter = n.attrs.parameter
      ? ["number", "integer", "boolean"].indexOf(n.attrs.parameter) + 1
      : 0;
    if (n.attrs.parameter && !parameter)
      error(n, "ARGUMENT", "parameter must be number, integer or boolean");
    if (
      signatures.has(n.attrs.name) &&
      signatures.get(n.attrs.name) !== parameter
    )
      error(
        n,
        "ACTION",
        "Actions sharing a command must use the same parameter type",
      );
    signatures.set(n.attrs.name, parameter);
    if (commands.some((c) => c.name === n.attrs.name && c.signal !== undefined))
      error(n, "ACTION", "Action conflicts with local command target");
    const targets = new Set<string>();
    const assignments = n.children.map((a) => {
      if (
        a.tag !== "set" ||
        Object.keys(a.attrs).some(
          (k) => !["target", "expression"].includes(k),
        ) ||
        a.children.length ||
        targets.has(a.attrs.target)
      )
        error(a, "ASSIGNMENT", "Expected unique set target and expression");
      targets.add(a.attrs.target);
      return {
        target: index(a, a.attrs.target, true),
        code: expr(a, a.attrs.expression ?? "", parameter > 0),
      };
    });
    if (!assignments.length || assignments.length > 128)
      error(n, "ACTION", "Expected 1..128 assignments");
    program.actions.push({
      name: n.attrs.name,
      parameter,
      guard: expr(n, n.attrs.guard ?? "true", parameter > 0),
      assignments,
    });
  }
  for (const n of source.clocks) {
    if (
      n.attrs.running &&
      signals.find((s) => s.name === n.attrs.running)?.type !== "boolean"
    )
      error(n, "CLOCK", "running must be boolean");
    const signal = index(n, `${n.attrs.name}.ms`, true),
      running = n.attrs.running ? index(n, n.attrs.running) : -1,
      rate = n.attrs.rate ? index(n, n.attrs.rate) : -1;
    program.clocks.push({ signal, running, rate });
  }
  for (const n of source.timers) {
    const clock = n.attrs.clock ? index(n, `${n.attrs.clock}.ms`) : -1,
      intervalMs = Number(n.attrs.intervalMs);
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 1 ||
      intervalMs > 3600000 ||
      !commands.some((c) => c.name === n.attrs.command) ||
      (clock >= 0 && !program.clocks.some((c) => c.signal === clock))
    )
      error(
        n,
        "TIMER",
        "Expected declared clock, period 1..3600000ms and existing command",
      );
    program.timers.push({ clock, intervalMs, command: n.attrs.command });
  }
  if (
    program.actions.length > 128 ||
    program.clocks.length > 8 ||
    program.timers.length > 32
  )
    error(
      source.actions[0] ?? source.clocks[0] ?? source.timers[0],
      "PROGRAM_LIMIT",
      "At most 128 actions, 8 clocks and 32 timers",
    );
  return program;
}
