import type { Instruction, Signal, Op } from "./types.js";

// A deliberately bounded numeric expression language. No eval or arbitrary functions; only bounded numeric built-ins.
const binary: Record<string, { priority: number; op: Op }> = {
  "||": { priority: 1, op: "or" },
  "&&": { priority: 2, op: "and" },
  "==": { priority: 3, op: "eq" },
  "!=": { priority: 3, op: "ne" },
  "<": { priority: 4, op: "lt" },
  "<=": { priority: 4, op: "le" },
  ">": { priority: 4, op: "gt" },
  ">=": { priority: 4, op: "ge" },
  "+": { priority: 5, op: "add" },
  "-": { priority: 5, op: "sub" },
  "*": { priority: 6, op: "mul" },
  "/": { priority: 6, op: "div" },
  "%": { priority: 6, op: "mod" },
};
export function compileExpression(
  text: string,
  signals: Signal[],
  allowArgument = false,
): Instruction[] {
  const tokens: string[] = [];
  let rest = text.trim();
  while (rest) {
    const m =
      /^(0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][\w.]*|&&|\|\||==|!=|<=|>=|[+*/%(),!<>?:-])/.exec(
        rest,
      );
    if (!m)
      throw new Error(`Unexpected expression token: ${rest.slice(0, 16)}`);
    tokens.push(m[0]);
    rest = rest.slice(m[0].length).trimStart();
    if (tokens.length > 512) throw new Error("Expression exceeds 512 tokens");
  }
  const functions: Record<string, [Op, number]> = {
    sin: ["sin", 1],
    cos: ["cos", 1],
    atan2: ["atan2", 2],
    hypot: ["hypot", 2],
    sqrt: ["sqrt", 1],
    abs: ["abs", 1],
    floor: ["floor", 1],
    ceil: ["ceil", 1],
    min: ["min", 2],
    max: ["max", 2],
    clamp: ["clamp", 3],
    clusterId: ["cluster_id", -1],
    clusterSize: ["cluster_size", -1],
    clusterX: ["cluster_x", -1],
    clusterY: ["cluster_y", -1],
    arg: ["argument", 0],
    fitScale: ["fit_scale", -2],
  };
  let cursor = 0;
  let depth = 0;
  const branch = (
    condition: Instruction[],
    yes: Instruction[],
    no: Instruction[],
  ): Instruction[] => [
    ...condition,
    { op: "jump_false", signal: yes.length + 1 },
    ...yes,
    { op: "jump", signal: no.length },
    ...no,
  ];
  function parse(minPriority = 0): Instruction[] {
    if (++depth > 24) throw new Error("Expression nesting exceeds 24");
    const token = tokens[cursor++];
    let result: Instruction[];
    if (token === "-" || token === "!")
      result = [...parse(7), { op: token === "-" ? "neg" : "not" }];
    else if (token === "(") {
      result = parse();
      if (tokens[cursor++] !== ")") throw new Error("Expected )");
    } else if (token && functions[token] && tokens[cursor] === "(") {
      cursor++;
      const [op, arity] = functions[token];
      result = [];
      let count = 0;
      if (op === "argument" && !allowArgument)
        throw Error("arg() requires a parameterized action");
      if (arity !== 0)
        do {
          if (count && tokens[cursor++] !== ",") throw Error("Expected ,");
          result.push(...parse());
          count++;
          if (count > 130) throw Error("Too many function arguments");
        } while (arity < 0 ? tokens[cursor] !== ")" : count < arity);
      if (tokens[cursor++] !== ")") throw Error("Expected )");
      if (arity < 0) {
        const prefix = arity === -2 ? 5 : 2;
        if (count < prefix + 2 || (count - prefix) % 2)
          throw Error("Expected controls and coordinate pairs");
        result.push({ op, signal: (count - prefix) / 2 });
      } else result.push({ op });
    } else if (token && /^\d/.test(token)) {
      const n = Number(token);
      if (!Number.isFinite(n)) throw new Error("Non-finite constant");
      result = [{ op: "const", value: n }];
    } else if (token === "true" || token === "false")
      result = [{ op: "const", value: token === "true" ? 1 : 0 }];
    else {
      const i = signals.findIndex((s) => s.name === token);
      if (i < 0) throw new Error(`Unknown signal ${token ?? "<end>"}`);
      if (signals[i].type === "string")
        throw new Error(
          `String signal ${token} cannot be used in numeric expressions`,
        );
      result = [{ op: "load", signal: i }];
    }
    while (
      binary[tokens[cursor]] &&
      binary[tokens[cursor]].priority >= minPriority
    ) {
      const operation = binary[tokens[cursor++]];
      const rhs = parse(operation.priority + 1);
      if (operation.op === "and")
        result = branch(
          result,
          [...rhs, { op: "not" }, { op: "not" }],
          [{ op: "const", value: 0 }],
        );
      else if (operation.op === "or")
        result = branch(
          result,
          [{ op: "const", value: 1 }],
          [...rhs, { op: "not" }, { op: "not" }],
        );
      else result.push(...rhs, { op: operation.op });
    }
    if (minPriority === 0 && tokens[cursor] === "?") {
      cursor++;
      const yes = parse();
      if (tokens[cursor++] !== ":") throw new Error("Expected :");
      result = branch(result, yes, parse());
    }
    depth--;
    return result;
  }
  const result = parse();
  if (cursor !== tokens.length)
    throw new Error(`Unexpected token ${tokens[cursor]}`);
  if (result.length > 256)
    throw new Error("Expression exceeds 256 instructions");
  return result;
}

export function topologicalSignals(signals: Signal[]): number[] {
  const visited = new Set<number>(),
    active = new Set<number>(),
    result: number[] = [];
  function visit(i: number) {
    if (active.has(i))
      throw new Error(`Derived signal cycle at ${signals[i].name}`);
    if (visited.has(i)) return;
    active.add(i);
    for (const ins of signals[i].derived ?? [])
      if (ins.op === "load") visit(ins.signal!);
    active.delete(i);
    visited.add(i);
    result.push(i);
  }
  signals.forEach((_, i) => visit(i));
  return result;
}
