import { lowerDeclarative, compileProgram } from "./declarative.js";
import { bindingKinds } from "./generate.js";
import { parseXml } from "./xml.js";
import { compileExpression, topologicalSignals } from "./expression.js";
import {
  FORMAT_VERSION,
  type CompileInput,
  type CompileResult,
  type Diagnostic,
  type XmlNode,
  type Signal,
  type UINode,
  type Binding,
  type Command,
  type ValueType,
} from "./types.js";

const kinds = new Set([
  "panel",
  "text",
  "button",
  "bar",
  "slider",
  "arc",
  "switch",
  "image",
  "custom",
  "path",
  "polygon",
  "sector",
  "grid",
]);
export const properties = new Set([
  "x",
  "y",
  "width",
  "height",
  "bg",
  "color",
  "radius",
  "padding",
  "gap",
  "direction",
  "align",
  "fontSize",
  "textAlign",
  "text",
  "min",
  "max",
  "value",
  "hidden",
  "border",
  "borderColor",
  "opacity",
  "bgOpacity",
  "grow",
  "src",
  "navigate",
  "startAngle",
  "endAngle",
  "textKey",
  "customType",
  "font",
  "rotation",
  "scaleX",
  "scaleY",
  "pivotX",
  "pivotY",
  "clip",
  "bgEnd",
  "gradientDirection",
  "lineWidth",
  "dashLength",
  "dashGap",
  "points",
  "curve",
  "gridX",
  "gridY",
  "fade",
  "tailOpacity",
  "headOpacity",
  "radialOpacity",
  "fadePower",
  "innerRadius",
  "rasterSize",
]);
const types = new Set(["number", "integer", "boolean", "string", "enum"]);
const identifier = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function compile(input: CompileInput): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const error = (node: XmlNode, code: string, message: string) => {
    if (diagnostics.length < 128)
      diagnostics.push({ ...node.loc, code, message, severity: "error" });
  };
  const attributes = (node: XmlNode, allowed: string[]) => {
    for (const key of Object.keys(node.attrs))
      if (!allowed.includes(key))
        error(node, "ATTRIBUTE", `Unknown ${node.tag} attribute ${key}`);
  };
  const model = parseXml(
    input.model,
    input.modelFile ?? input.manifest.model,
    diagnostics,
  );
  const ui = parseXml(input.ui, input.uiFile ?? input.manifest.ui, diagnostics);
  if (!model || !ui) return { diagnostics };
  attributes(model, ["version"]);
  attributes(ui, ["version", "start", "locale"]);
  if (model.tag !== "model" || model.attrs.version !== "1")
    error(model, "MODEL_ROOT", 'Expected <model version="1">');
  if (ui.tag !== "dashboard" || ui.attrs.version !== "1")
    error(ui, "UI_ROOT", 'Expected <dashboard version="1">');
  if (input.manifest.formatVersion !== 1)
    error(ui, "VERSION", "Unsupported project formatVersion");
  if (!/^[A-Za-z_][\w]*$/.test(input.manifest.name ?? ""))
    error(ui, "PROJECT_NAME", "Project name must be a C identifier");
  if (input.manifest.lvglVersion !== "9.5.0")
    error(ui, "LVGL_VERSION", "This SDK supports LVGL 9.5.0");
  if (
    !Array.isArray(input.manifest.targets) ||
    !input.manifest.targets.length ||
    input.manifest.targets.some(
      (t) =>
        !t ||
        !identifier.test(t.name) ||
        !Number.isInteger(t.width) ||
        !Number.isInteger(t.height) ||
        t.width < 1 ||
        t.height < 1 ||
        t.width > 4096 ||
        t.height > 4096,
    )
  )
    error(
      ui,
      "TARGET",
      "Targets need a name and integer dimensions in 1..4096",
    );
  if (
    Array.isArray(input.manifest.targets) &&
    new Set(input.manifest.targets.map((t) => t?.name)).size !==
      input.manifest.targets.length
  )
    error(ui, "TARGET", "Target names must be unique");
  if (input.manifest.fonts !== undefined) {
    const fonts = input.manifest.fonts;
    if (!Array.isArray(fonts) || fonts.length > 16)
      error(ui, "FONT", "At most 16 declared fonts");
    else {
      const names = new Set<string>();
      for (const f of fonts) {
        if (
          !f ||
          !/^[A-Za-z_]\w*$/.test(f.name ?? "") ||
          names.has(f.name) ||
          typeof f.file !== "string" ||
          !Number.isInteger(f.size) ||
          f.size < 8 ||
          f.size > 160 ||
          typeof f.characters !== "string" ||
          !f.characters.length ||
          f.characters.length > 8192
        )
          error(ui, "FONT", "Invalid font declaration");
        if (f) names.add(f.name);
      }
    }
  }
  const declaration = lowerDeclarative(model, ui, error);
  const signals: Signal[] = [],
    signalNodes: XmlNode[] = [],
    commands: Command[] = [];
  for (const node of model.children) {
    attributes(
      node,
      node.tag === "command"
        ? ["name", "target", "value"]
        : [
            "name",
            "type",
            "initial",
            "unit",
            "timeoutMs",
            "choices",
            ...(node.tag === "computed" ? ["expression"] : []),
          ],
    );
    if (node.children.length)
      error(node, "MODEL_ELEMENT", `${node.tag} cannot contain child elements`);
    if (node.tag === "command") continue;
    if (!["signal", "computed"].includes(node.tag)) {
      error(node, "MODEL_ELEMENT", `Unknown model element ${node.tag}`);
      continue;
    }
    const name = node.attrs.name,
      type = (node.attrs.type ?? "number") as ValueType;
    if (!identifier.test(name ?? ""))
      error(node, "SIGNAL_NAME", "Signal needs a valid name");
    if (signals.some((s) => s.name === name))
      error(node, "DUPLICATE_SIGNAL", `Duplicate signal ${name}`);
    if (!types.has(type))
      error(node, "SIGNAL_TYPE", `Unknown signal type ${type}`);
    const raw =
      node.attrs.initial ??
      (type === "string" ? "" : type === "boolean" ? "false" : "0");
    let initial: Signal["initial"] =
      type === "string"
        ? raw
        : type === "boolean"
          ? raw === "true"
          : Number(raw);
    if (type === "boolean" && !["true", "false"].includes(raw))
      error(node, "SIGNAL_INITIAL", "Boolean initial must be true or false");
    if (
      typeof initial === "number" &&
      (!Number.isFinite(initial) ||
        (["integer", "enum"].includes(type) &&
          (!Number.isInteger(initial) || Math.abs(initial) > 2147483647)))
    )
      error(node, "SIGNAL_INITIAL", `Invalid initial value for ${type}`);
    if (type === "string" && new TextEncoder().encode(raw).length > 255)
      error(node, "SIGNAL_INITIAL", "String exceeds 255 UTF-8 bytes");
    const timeoutMs = Number(node.attrs.timeoutMs ?? 0);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)
      error(node, "TIMEOUT", "timeoutMs must be a nonnegative int32");
    const choices =
      type === "enum"
        ? (node.attrs.choices ?? "").split("|").filter(Boolean)
        : undefined;
    if (
      type === "enum" &&
      (!choices?.length ||
        choices.length > 256 ||
        Number(initial) < 0 ||
        Number(initial) >= choices.length)
    )
      error(node, "ENUM", "Enum requires choices and an initial choice index");
    signals.push({
      name,
      type,
      initial,
      timeoutMs,
      unit: node.attrs.unit ?? "",
      choices,
    });
    signalNodes.push(node);
  }
  if (signals.length > 256)
    error(model, "SIGNAL_LIMIT", "At most 256 signals are supported");
  signals.forEach((signal, i) => {
    const node = signalNodes[i];
    if (node.tag === "computed") {
      if (signal.type === "string") {
        error(
          node,
          "EXPRESSION_TYPE",
          "Computed strings use binding format; computed values must be numeric",
        );
        return;
      }
      try {
        signal.derived = compileExpression(
          node.attrs.expression ?? "",
          signals,
        );
      } catch (e) {
        error(node, "EXPRESSION", (e as Error).message);
      }
    }
  });
  let evaluationOrder: number[] = [];
  try {
    evaluationOrder = topologicalSignals(signals);
  } catch (e) {
    error(model, "DERIVED_CYCLE", (e as Error).message);
  }
  for (const node of model.children.filter((n) => n.tag === "command")) {
    const name = node.attrs.name;
    if (!identifier.test(name ?? "") || commands.some((c) => c.name === name))
      error(node, "COMMAND_NAME", "Command name is invalid or duplicated");
    const target = signals.findIndex((s) => s.name === node.attrs.target);
    const value = Number(node.attrs.value ?? 0);
    if (
      node.attrs.target &&
      (target < 0 ||
        signals[target].derived ||
        signals[target].type === "string")
    )
      error(
        node,
        "COMMAND_TARGET",
        "Local command target must be a writable numeric signal",
      );
    if (!Number.isFinite(value))
      error(node, "COMMAND_VALUE", "Command value must be finite");
    commands.push({
      name,
      ...(node.attrs.target ? { signal: target, value } : {}),
    });
  }
  const program = compileProgram(declaration, signals, commands, error);
  const locales = new Map<string, Map<string, string>>();
  const defaultLocale = ui.attrs.locale ?? "en";
  for (const section of ui.children.filter((n) => n.tag === "translations")) {
    attributes(section, []);
    for (const locale of section.children) {
      attributes(locale, ["name"]);
      if (
        locale.tag !== "locale" ||
        !/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(locale.attrs.name ?? "") ||
        locales.has(locale.attrs.name)
      )
        error(locale, "LOCALE", "Expected unique locale name");
      const entries = new Map<string, string>();
      for (const entry of locale.children) {
        attributes(entry, ["key", "value"]);
        if (
          entry.tag !== "message" ||
          !identifier.test(entry.attrs.key ?? "") ||
          entries.has(entry.attrs.key) ||
          entry.attrs.value === undefined ||
          new TextEncoder().encode(entry.attrs.value ?? "").length > 4096
        )
          error(entry, "TRANSLATION", "Expected unique message key and value");
        entries.set(entry.attrs.key, entry.attrs.value ?? "");
      }
      locales.set(locale.attrs.name, entries);
    }
  }
  if (locales.size > 16 || (locales.size && !locales.has(defaultLocale)))
    error(ui, "LOCALE", "Default locale is missing or exceeds 16 locales");
  const components = new Map<string, XmlNode>(),
    styles = new Map<string, Record<string, string>>();
  for (const node of ui.children) {
    if (node.tag === "component") {
      attributes(node, ["name"]);
      if (
        !identifier.test(node.attrs.name ?? "") ||
        components.has(node.attrs.name)
      )
        error(node, "COMPONENT_NAME", "Invalid or duplicate component name");
      components.set(node.attrs.name, node);
    } else if (node.tag === "styles") {
      attributes(node, []);
      for (const style of node.children) {
        if (
          style.tag !== "style" ||
          !style.attrs.name ||
          styles.has(style.attrs.name)
        )
          error(style, "STYLE", "Expected uniquely named style");
        const { name, ...props } = style.attrs;
        for (const key of Object.keys(props))
          if (!properties.has(key))
            error(style, "PROPERTY", `Unknown style property ${key}`);
        styles.set(name, props);
      }
    } else if (!["page", "translations", "inputs"].includes(node.tag))
      error(node, "UI_ELEMENT", `Unknown dashboard child ${node.tag}`);
  }
  const ids = new Set<string>();
  let count = 0;
  function build(
    node: XmlNode,
    prefix: string,
    index: number,
    chain: string[] = [],
    fills = new Map<string, XmlNode[]>(),
  ): UINode[] {
    if (count >= 512) {
      error(node, "NODE_LIMIT", "At most 512 expanded nodes are supported");
      return [];
    }
    if (node.tag === "slot")
      return (fills.get(node.attrs.name) ?? node.children).flatMap((n, i) =>
        build(n, prefix + ".slot." + node.attrs.name, i, chain),
      );
    if (node.tag === "use") {
      const name = node.attrs.component,
        definition = components.get(name);
      if (!definition) {
        error(node, "COMPONENT_REF", `Unknown component ${name}`);
        return [];
      }
      if (chain.includes(name) || chain.length > 16) {
        error(node, "COMPONENT_CYCLE", `Recursive component ${name}`);
        return [];
      }
      const params: Record<string, string> = Object.create(null);
      for (const param of definition.children.filter(
        (c) => c.tag === "param",
      )) {
        attributes(param, ["name", "default"]);
        if (
          !/^[A-Za-z_]\w*$/.test(param.attrs.name ?? "") ||
          Object.hasOwn(params, param.attrs.name)
        )
          error(
            param,
            "COMPONENT_PARAM",
            "Invalid or duplicate parameter name",
          );
        const val = node.attrs[param.attrs.name] ?? param.attrs.default;
        if (val === undefined)
          error(node, "COMPONENT_PARAM", `Missing ${param.attrs.name}`);
        params[param.attrs.name] = val ?? "";
      }
      attributes(node, ["component", "id", ...Object.keys(params)]);
      const slots = new Set<string>();
      const collectSlots = (n: XmlNode) => {
        if (n.tag === "slot") {
          attributes(n, ["name"]);
          if (!n.attrs.name || slots.has(n.attrs.name))
            error(n, "SLOT", "Invalid or duplicate slot name");
          slots.add(n.attrs.name);
        }
        n.children.forEach(collectSlots);
      };
      definition.children.forEach(collectSlots);
      const expand = (n: XmlNode): XmlNode => ({
        ...n,
        attrs: Object.fromEntries(
          Object.entries(n.attrs).map(([k, v]) => [
            k,
            v.replace(/\$\{(\w+)\}/g, (_, p: string) => {
              if (!(p in params))
                error(n, "COMPONENT_PARAM", `Unknown parameter ${p}`);
              return params[p] ?? "";
            }),
          ]),
        ),
        children: n.children.map(expand),
      });
      const nextFills = new Map<string, XmlNode[]>();
      for (const fill of node.children) {
        attributes(fill, ["slot"]);
        if (!slots.has(fill.attrs.slot) || nextFills.has(fill.attrs.slot))
          error(fill, "SLOT", `Unknown or duplicate slot ${fill.attrs.slot}`);
        if (fill.tag !== "fill")
          error(fill, "SLOT", 'Use children must be <fill slot="...">');
        else nextFills.set(fill.attrs.slot, fill.children);
      }
      const children = definition.children.filter((c) => c.tag !== "param");
      if (children.length !== 1)
        error(
          definition,
          "COMPONENT_ROOT",
          "A component needs exactly one root widget",
        );
      return children.flatMap((n, i) =>
        build(
          expand(n),
          prefix + "." + (node.attrs.id ?? `${name}${index}`),
          i,
          [...chain, name],
          nextFills,
        ),
      );
    }
    if (!kinds.has(node.tag) && node.tag !== "page") {
      error(node, "WIDGET", `Unknown widget ${node.tag}`);
      return [];
    }
    const id = node.attrs.id
      ? chain.length
        ? prefix + "." + node.attrs.id
        : node.attrs.id
      : `${prefix}.${node.tag}${index}`;
    if (!identifier.test(id)) error(node, "NODE_ID", `Invalid node id ${id}`);
    if (ids.has(id)) error(node, "DUPLICATE_ID", `Duplicate node id ${id}`);
    ids.add(id);
    count++;
    const props: Record<string, string> = {};
    for (const name of (node.attrs.style ?? "").split(" ").filter(Boolean)) {
      if (!styles.has(name)) error(node, "STYLE_REF", `Unknown style ${name}`);
      else Object.assign(props, styles.get(name));
    }
    for (const [key, value] of Object.entries(node.attrs)) {
      if (["id", "style"].includes(key)) continue;
      if (
        !properties.has(key) &&
        !(node.tag === "custom" && /^custom\.[A-Za-z_]\w*$/.test(key))
      )
        error(node, "PROPERTY", `Unknown property ${key}`);
      else props[key] = value;
    }
    for (const [key, value] of Object.entries(props)) {
      if (new TextEncoder().encode(value).length > 4096)
        error(node, "PROPERTY_SIZE", `${key} exceeds 4096 UTF-8 bytes`);
      if (
        ["bg", "color", "borderColor", "bgEnd"].includes(key) &&
        !/^#[0-9a-fA-F]{6}$/.test(value)
      )
        error(node, "COLOR", `${key} must be #RRGGBB`);
      if (
        [
          "x",
          "y",
          "radius",
          "padding",
          "gap",
          "fontSize",
          "min",
          "max",
          "value",
          "border",
          "opacity",
          "bgOpacity",
          "grow",
          "startAngle",
          "endAngle",
        ].includes(key) &&
        (!/^-?\d+$/.test(value) || Math.abs(Number(value)) > 32767)
      )
        error(node, "NUMBER", `${key} must be an integer in -32767..32767`);
      if (
        ["width", "height"].includes(key) &&
        !/^(?:\d+%?|content)$/.test(value)
      )
        error(node, "SIZE", `${key} must be pixels, percent or content`);
      if (key === "direction" && !["row", "column"].includes(value))
        error(node, "DIRECTION", "direction must be row or column");
      if (
        key === "align" &&
        ![
          "center",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ].includes(value)
      )
        error(node, "ALIGN", "Invalid align");
      if (key === "hidden" && !["true", "false"].includes(value))
        error(node, "BOOLEAN", "hidden must be true or false");
      if (key === "src" && !/^A:[A-Za-z0-9_./-]+\.png$/.test(value))
        error(node, "RESOURCE", "Image src must be A:relative/path.png");
      if (key === "src" && value.slice(2).split("/").includes(".."))
        error(node, "RESOURCE", "Image resource cannot leave the project");
      if (key === "fontSize" && ![14, 20, 28, 40, 48].includes(Number(value)))
        error(node, "FONT", "Built-in fontSize must be 14, 20, 28, 40 or 48");
      if (key === "textAlign" && !["left", "center", "right"].includes(value))
        error(node, "ALIGN", "textAlign must be left, center or right");
      if (
        ["width", "height"].includes(key) &&
        value !== "content" &&
        Number(value.replace("%", "")) > (value.endsWith("%") ? 100 : 4096)
      )
        error(node, "SIZE", `${key} exceeds the supported size`);
      if (
        ["radius", "padding", "gap", "border", "grow", "opacity"].includes(
          key,
        ) &&
        Number(value) < 0
      )
        error(node, "NUMBER", `${key} cannot be negative`);
      if (["opacity", "bgOpacity", "grow"].includes(key) && Number(value) > 255)
        error(node, "NUMBER", `${key} cannot exceed 255`);
    }
    for (const key of [
      "rotation",
      "scaleX",
      "scaleY",
      "pivotX",
      "pivotY",
      "lineWidth",
      "dashLength",
      "dashGap",
      "gridX",
      "gridY",
    ])
      if (
        props[key] !== undefined &&
        (!/^-?\d+$/.test(props[key]) ||
          Math.abs(Number(props[key])) > 32767 ||
          (["scaleX", "scaleY", "lineWidth", "dashLength", "dashGap"].includes(
            key,
          ) &&
            Number(props[key]) < 0) ||
          (["gridX", "gridY"].includes(key) && Number(props[key]) < 2))
      )
        error(node, "GEOMETRY", `Invalid ${key}`);
    for (const [key, min, max] of [
      ["tailOpacity", 0, 255],
      ["headOpacity", 0, 255],
      ["radialOpacity", 0, 255],
      ["fadePower", 1, 8],
      ["innerRadius", 0, 99],
      ["rasterSize", 32, 512],
    ] as const) {
      if (
        props[key] !== undefined &&
        (node.tag !== "sector" ||
          !/^\d+$/.test(props[key]) ||
          Number(props[key]) < min ||
          Number(props[key]) > max)
      )
        error(node, "GEOMETRY", `${key} is a sector integer in ${min}..${max}`);
    }
    if (props.clip !== undefined && !["true", "false"].includes(props.clip))
      error(node, "GEOMETRY", "clip must be boolean");
    if (props.fade !== undefined && !["true", "false"].includes(props.fade))
      error(node, "GEOMETRY", "fade must be boolean");
    if (props.curve && !["linear", "catmull-rom"].includes(props.curve))
      error(node, "GEOMETRY", "Invalid curve");
    if (
      props.gradientDirection &&
      !["horizontal", "vertical"].includes(props.gradientDirection)
    )
      error(node, "GEOMETRY", "Invalid gradientDirection");
    if (props.points) {
      const pts = props.points.split(/\s+/);
      if (
        pts.length < 2 ||
        pts.length > 64 ||
        pts.some(
          (p) =>
            !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(p) ||
            p.split(",").some((v) => Math.abs(Number(v)) > 32767),
        )
      )
        error(node, "GEOMETRY", "points requires 2..64 bounded x,y pairs");
    }
    if (Number(props.min ?? 0) >= Number(props.max ?? 100))
      error(node, "RANGE", "min must be smaller than max");
    if (node.tag === "custom" && !/^[A-Za-z_]\w*$/.test(props.customType ?? ""))
      error(node, "CUSTOM", "custom requires customType C registry name");
    if (props.font && !/^[A-Za-z_]\w*$/.test(props.font))
      error(node, "FONT", "font must be a registered C font name");
    if (props.textKey) {
      if (!["text", "button"].includes(node.tag))
        error(node, "TRANSLATION", "textKey requires text or button");
      for (const [locale, entries] of locales) {
        const text = entries.get(props.textKey);
        if (text === undefined)
          error(node, "TRANSLATION", `Missing ${locale}:${props.textKey}`);
        else props["l10n." + locale] = text;
      }
      if (!locales.size)
        error(node, "TRANSLATION", "textKey requires translations");
      props.locale = defaultLocale;
    }
    const bindings: Binding[] = [];
    let command: string | undefined;
    for (const child of node.children) {
      if (child.tag === "animate") {
        attributes(child, [
          "property",
          "from",
          "to",
          "durationMs",
          "delayMs",
          "repeat",
          "easing",
        ]);
        const a = child.attrs,
          property = a.property;
        if (
          !["x", "y", "opacity", "value"].includes(property) ||
          props["anim." + property]
        )
          error(
            child,
            "ANIMATION",
            "Expected unique x/y/opacity/value animation",
          );
        for (const key of ["from", "to", "durationMs", "delayMs", "repeat"]) {
          const v = Number(a[key] ?? (key === "durationMs" ? 300 : 0));
          if (
            !Number.isInteger(v) ||
            v < (key === "from" || key === "to" ? -32767 : 0) ||
            v > (key === "from" || key === "to" ? 32767 : 3600000)
          )
            error(child, "ANIMATION", `Invalid ${key}`);
        }
        if (
          Number(a.durationMs ?? 300) < 1 ||
          (property === "opacity" &&
            [a.from, a.to].some(
              (v) => Number(v ?? 0) < 0 || Number(v ?? 0) > 255,
            ))
        )
          error(child, "ANIMATION", "Invalid animation range/duration");
        if (a.easing && !["linear", "ease-in-out"].includes(a.easing))
          error(child, "ANIMATION", "Unsupported easing");
        if (
          property === "value" &&
          !["bar", "slider", "arc"].includes(node.tag)
        )
          error(child, "ANIMATION", "value animation requires bar/slider/arc");
        props["anim." + property] = [
          a.from ?? 0,
          a.to ?? 0,
          a.durationMs ?? 300,
          a.delayMs ?? 0,
          a.repeat ?? 0,
          a.easing === "ease-in-out" ? 1 : 0,
        ]
          .map(Number)
          .join(",");
      } else if (child.tag === "bind") {
        attributes(child, ["property", "signal", "direction", "format"]);
        if (child.children.length)
          error(child, "BIND", "bind cannot contain children");
        const signal = signals.findIndex((s) => s.name === child.attrs.signal),
          property = child.attrs.property as Binding["property"];
        if (signal < 0)
          error(child, "BIND_SIGNAL", `Unknown signal ${child.attrs.signal}`);
        if (!bindingKinds.includes(property))
          error(child, "BIND_PROPERTY", `Unknown binding property ${property}`);
        if (/^p\d+[xy]$/.test(property)) {
          const point = Number(property.slice(1, -1));
          if (
            !["path", "polygon"].includes(node.tag) ||
            point >= (props.points?.split(/\s+/).length ?? 0)
          )
            error(
              child,
              "BIND_POINT",
              "Point binding outside declared geometry",
            );
        }
        const twoWay = child.attrs.direction === "two-way";
        if (
          child.attrs.direction &&
          !["one-way", "two-way"].includes(child.attrs.direction)
        )
          error(
            child,
            "BIND_DIRECTION",
            "direction must be one-way or two-way",
          );
        if (
          twoWay &&
          (signal < 0 ||
            signals[signal].derived ||
            !(
              (node.tag === "slider" && property === "value") ||
              (node.tag === "switch" && property === "checked")
            ))
        )
          error(
            child,
            "BIND_TWO_WAY",
            "Two-way binding requires a slider/value or switch/checked and a writable signal",
          );
        if (
          signal >= 0 &&
          signals[signal].type === "string" &&
          property !== "text" &&
          property !== "quality"
        )
          error(child, "BIND_TYPE", "String signals only bind text or quality");
        if (
          property === "text" &&
          !["text", "button", "custom"].includes(node.tag)
        )
          error(child, "BIND_TYPE", "Text binding requires text or button");
        if (
          property === "value" &&
          !["bar", "slider", "arc", "custom"].includes(node.tag)
        )
          error(
            child,
            "BIND_TYPE",
            "Value binding requires bar, slider or arc",
          );
        if (property === "checked" && node.tag !== "switch")
          error(child, "BIND_TYPE", "Checked binding requires switch");
        if (
          property === "quality" &&
          !["text", "button", "custom"].includes(node.tag)
        )
          error(child, "BIND_TYPE", "Quality binding requires text or button");
        if (
          twoWay &&
          signal >= 0 &&
          property === "checked" &&
          signals[signal].type !== "boolean"
        )
          error(child, "BIND_TYPE", "Two-way switch requires a boolean");
        if (
          twoWay &&
          signal >= 0 &&
          property === "value" &&
          !["number", "integer"].includes(signals[signal].type)
        )
          error(
            child,
            "BIND_TYPE",
            "Two-way slider requires number or integer",
          );
        const format = child.attrs.format;
        if (
          format &&
          !/^[^%]*(?:%(?:\.\d{1,2})?[fsd])[^%]*$/.test(
            format.replace(/%%/g, ""),
          )
        )
          error(
            child,
            "FORMAT",
            "format accepts one %d, %s or %.Nf placeholder and literal %%",
          );
        if (format && signal >= 0) {
          if (
            signals[signal].type === "string"
              ? !format.includes("%s")
              : format.includes("%s")
          )
            error(
              child,
              "FORMAT_TYPE",
              "Format placeholder does not match signal type",
            );
        }
        if (bindings.some((b) => b.property === property))
          error(child, "BIND_DUPLICATE", `Duplicate binding for ${property}`);
        bindings.push({
          signal,
          property,
          twoWay,
          ...(format ? { format } : {}),
        });
      } else if (child.tag === "on") {
        attributes(child, ["event", "command", "argument", "argumentSignal"]);
        if (child.children.length)
          error(child, "EVENT", "on cannot contain children");
        if (child.attrs.event !== "click" || node.tag !== "button")
          error(child, "EVENT", "Current events support button click");
        command = child.attrs.command;
        if (
          child.attrs.argument !== undefined ||
          child.attrs.argumentSignal !== undefined
        ) {
          if (
            !program.actions.some(
              (a) => a.name === command && a.parameter > 0,
            ) ||
            (child.attrs.argument !== undefined &&
              child.attrs.argumentSignal !== undefined)
          )
            error(
              child,
              "ARGUMENT",
              "Expected parameterized action and one argument source",
            );
          if (child.attrs.argument !== undefined) {
            if (!Number.isFinite(Number(child.attrs.argument)))
              error(child, "ARGUMENT", "Argument must be finite");
            props["command.argument"] = child.attrs.argument;
          } else {
            const index = signals.findIndex(
              (s) => s.name === child.attrs.argumentSignal,
            );
            if (index < 0 || signals[index].type === "string")
              error(child, "ARGUMENT", "Expected numeric argumentSignal");
            props["command.argumentSignal"] = String(index);
          }
        }
        if (!commands.some((c) => c.name === command))
          error(child, "COMMAND_REF", `Unknown command ${command}`);
      }
    }
    return [
      {
        id,
        kind: (node.tag === "page" ? "panel" : node.tag) as UINode["kind"],
        props,
        bindings,
        command,
        children: node.children
          .filter((n) => !["bind", "on", "animate"].includes(n.tag))
          .flatMap((n, i) => build(n, id, i, chain, fills)),
        loc: node.loc,
      },
    ];
  }
  const pages = ui.children
    .filter((n) => n.tag === "page")
    .flatMap((n, i) => build(n, "page", i));
  for (const section of ui.children.filter((n) => n.tag === "inputs")) {
    attributes(section, []);
    const seen = new Set<string>();
    for (const key of section.children) {
      attributes(key, ["action", "command"]);
      if (
        key.children.length ||
        key.tag !== "key" ||
        ![
          "up",
          "down",
          "left",
          "right",
          "confirm",
          "back",
          "next",
          "previous",
        ].includes(key.attrs.action) ||
        seen.has(key.attrs.action) ||
        !commands.some((c) => c.name === key.attrs.command)
      )
        error(
          key,
          "INPUT",
          "Expected unique semantic action and existing command",
        );
      seen.add(key.attrs.action);
      for (const page of pages)
        page.props["input." + key.attrs.action] = key.attrs.command;
    }
  }
  if (!pages.length)
    error(ui, "PAGE_REQUIRED", "At least one page is required");
  if (count > 512) error(ui, "NODE_LIMIT", "At most 512 nodes are supported");
  const initialPage = ui.attrs.start ?? pages[0]?.id;
  if (!pages.some((p) => p.id === initialPage))
    error(ui, "PAGE_REF", `Unknown start page ${initialPage}`);
  function checkNavigation(node: UINode) {
    if (node.props.navigate && !pages.some((p) => p.id === node.props.navigate))
      error(
        { tag: "page", attrs: {}, children: [], loc: node.loc },
        "PAGE_REF",
        `Unknown navigation page ${node.props.navigate}`,
      );
    node.children.forEach(checkNavigation);
  }
  pages.forEach(checkNavigation);
  function checkProps(node: UINode) {
    if (Object.keys(node.props).length > 64)
      error(
        { loc: node.loc } as XmlNode,
        "PROPERTY_LIMIT",
        "At most 64 lowered properties per node",
      );
    for (const binding of node.bindings)
      if (node.props["anim." + binding.property])
        error(
          { loc: node.loc } as XmlNode,
          "ANIMATION",
          "Animation conflicts with binding",
        );
    if (
      node.props.textKey &&
      node.bindings.some(
        (b) => b.property === "text" || b.property === "quality",
      )
    )
      error(
        { loc: node.loc } as XmlNode,
        "TRANSLATION",
        "Translated text cannot also have a text binding",
      );
    node.children.forEach(checkProps);
  }
  pages.forEach(checkProps);
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };
  return {
    diagnostics,
    ir: {
      formatVersion: FORMAT_VERSION,
      name: input.manifest.name,
      lvglVersion: "9.5.0",
      targets: input.manifest.targets,
      signals,
      commands,
      pages,
      initialPage,
      evaluationOrder,
      program,
    },
  };
}
