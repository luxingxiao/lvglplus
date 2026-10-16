// SPDX-License-Identifier: Apache-2.0
import createRuntime from "./runtime/lvp.js";
const error = document.querySelector("#error");
try {
  const m = await createRuntime({ locateFile: (n) => "./runtime/" + n });
  const f = (name, ret, args = []) => m.cwrap("lvp_preview_" + name, ret, args);
  const load = f("load", "number", ["number", "number"]),
    tick = f("tick", null, ["number"]),
    pixels = f("pixels", "number"),
    width = f("width", "number"),
    height = f("height", "number"),
    set = f("set", "number", ["number", "number", "number", "number"]),
    setText = f("set_text", "number", ["number", "string", "number", "number"]),
    number = f("number", "number", ["number"]),
    text = f("text", "string", ["number"]),
    quality = f("quality", "number", ["number"]),
    locale = f("locale", "number", ["string"]),
    pointer = f("pointer", null, ["number", "number", "number"]);
  const project = await (await fetch("./project.json")).json();
  for (const asset of project.assets) {
    if (asset.path.startsWith("/") || asset.path.split("/").includes(".."))
      throw Error("Invalid asset");
    const name = "/" + asset.path;
    m.FS.mkdirTree(name.slice(0, name.lastIndexOf("/")) || "/");
    m.FS.writeFile(
      name,
      Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0)),
    );
  }
  const bytes = new Uint8Array(await (await fetch("./ui.lvp")).arrayBuffer()),
    ptr = m._malloc(bytes.length);
  try {
    m.HEAPU8.set(bytes, ptr);
    if (load(ptr, bytes.length) !== 0) throw Error(f("error", "string")());
  } finally {
    m._free(ptr);
  }
  const c = document.querySelector("canvas");
  c.tabIndex = 0;
  c.setAttribute("aria-label", "LVGL preview: arrows, Enter, Escape");
  const action = f("action", "number", ["string"]);
  c.addEventListener("keydown", (e) => {
    const keys = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Enter: "confirm",
      Escape: "back",
      PageDown: "next",
      PageUp: "previous",
    };
    if (keys[e.key]) {
      e.preventDefault();
      action(keys[e.key]);
    }
  });
  c.width = width();
  c.height = height();
  const ctx = c.getContext("2d"),
    image = ctx.createImageData(c.width, c.height),
    inputs = [];
  project.ir.signals.forEach((s, i) => {
    const label = document.createElement("label");
    label.textContent = s.name;
    const input = document.createElement("input");
    input.setAttribute("aria-label", s.name);
    input.disabled = !!s.derived;
    input.onchange = () => {
      const result =
        s.type === "string"
          ? setText(i, input.value, performance.now(), 0)
          : set(
              i,
              s.type === "boolean"
                ? Number(input.value === "true" || input.value === "1")
                : Number(input.value),
              performance.now(),
              0,
            );
      if (result) error.textContent = "Invalid value: " + s.name;
    };
    label.append(input);
    document.querySelector("#signals").append(label);
    inputs.push(input);
  });
  const locales = new Set();
  const collect = (n) => {
    Object.keys(n.props)
      .filter((k) => k.startsWith("l10n."))
      .forEach((k) => locales.add(k.slice(5)));
    n.children.forEach(collect);
  };
  project.ir.pages.forEach(collect);
  for (const l of locales) {
    const o = document.createElement("option");
    o.textContent = l;
    document.querySelector("#locale").append(o);
  }
  document.querySelector("#locale").onchange = (e) => locale(e.target.value);
  let last = 0;
  function draw(now) {
    tick(now);
    const p = pixels(),
      heap = m.HEAPU8;
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = heap[p + i + 2];
      image.data[i + 1] = heap[p + i + 1];
      image.data[i + 2] = heap[p + i];
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (now - last > 200) {
      inputs.forEach((input, i) => {
        if (document.activeElement !== input)
          input.value =
            project.ir.signals[i].type === "string"
              ? text(i)
              : String(Math.round(number(i) * 100) / 100);
        input.title = ["valid", "stale", "invalid", "disconnected"][quality(i)];
      });
      last = now;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  for (const type of [
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointercancel",
  ])
    c.addEventListener(type, (e) => {
      if (type === "pointermove" && !e.buttons) return;
      const r = c.getBoundingClientRect();
      pointer(
        Math.round(((e.clientX - r.left) * c.width) / r.width),
        Math.round(((e.clientY - r.top) * c.height) / r.height),
        type === "pointerdown" || (type === "pointermove" && e.buttons) ? 1 : 0,
      );
      if (type === "pointerdown") c.setPointerCapture(e.pointerId);
    });
  document.querySelector("#restart").onclick = () =>
    f("restart_animations", null)();
  document.querySelector("#png").onclick = () => {
    const a = document.createElement("a");
    a.download = "lvglplus.png";
    a.href = c.toDataURL("image/png");
    a.click();
  };
} catch (e) {
  error.textContent = e.message;
}
