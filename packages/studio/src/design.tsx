// SPDX-License-Identifier: Apache-2.0
import React, { useState } from "react";
import { type ProjectIR, flatten } from "@lvglplus/compiler";

export function editXml(
  source: string,
  id: string,
  action: (node: Element, doc: Document) => void,
) {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("Fix XML diagnostics before visual editing");
  const candidates = Array.from(doc.querySelectorAll("[id]")).filter(
    (n) => n.getAttribute("id") === id,
  );
  if (candidates.length !== 1)
    throw new Error(
      "Select an authored node; expanded components are edited through their use parameters or template",
    );
  action(candidates[0], doc);
  return new XMLSerializer().serializeToString(doc);
}
export function DesignTools({
  source,
  selected,
  ir,
  apply,
  undo,
  redo,
}: {
  source: string;
  selected: string;
  ir: ProjectIR;
  apply: (source: string) => void;
  undo: () => void;
  redo: () => void;
}) {
  const [kind, setKind] = useState("text"),
    [key, setKey] = useState("text"),
    [value, setValue] = useState(""),
    [signal, setSignal] = useState(ir.signals[0]?.name ?? ""),
    [binding, setBinding] = useState("text"),
    [twoWay, setTwoWay] = useState(false),
    [command, setCommand] = useState(ir.commands[0]?.name ?? ""),
    [property, setProperty] = useState("opacity"),
    [from, setFrom] = useState("0"),
    [to, setTo] = useState("255"),
    [duration, setDuration] = useState("1000"),
    [error, setError] = useState("");
  const act = (action: (node: Element, doc: Document) => void) => {
    try {
      apply(editXml(source, selected, action));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const child = (
    tag: string,
    attrs: Record<string, string>,
    match: (n: Element) => boolean,
  ) =>
    act((node, doc) => {
      let n = Array.from(node.children).find(
        (n) => n.tagName === tag && match(n),
      );
      if (!n) {
        n = doc.createElement(tag);
        node.appendChild(n);
      }
      for (const a of Array.from(n.attributes)) n.removeAttribute(a.name);
      for (const [key, value] of Object.entries(attrs))
        n.setAttribute(key, value);
    });
  return (
    <section className="design-tools">
      <h3>DESIGN · {selected || "select a node"}</h3>
      <p>
        Drag to move · Shift-drag to resize · grid 4 px. Save applies XML and
        LVGL together.
      </p>
      <div className="design-row" aria-label="Widget palette">
        {[
          "panel",
          "text",
          "button",
          "bar",
          "slider",
          "arc",
          "switch",
          "image",
        ].map((kind) => (
          <button
            key={kind}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData("application/lvglplus-widget", kind)
            }
          >
            {kind}
          </button>
        ))}
      </div>
      <div className="design-row">
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
        <button
          onClick={() =>
            act((n) => {
              if (n.tagName === "page")
                throw new Error("Pages are removed in XML");
              n.remove();
            })
          }
        >
          Delete node
        </button>
      </div>
      <div className="design-row">
        <select
          aria-label="Widget kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {[
            "panel",
            "text",
            "button",
            "bar",
            "slider",
            "arc",
            "switch",
            "image",
          ].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button
          onClick={() =>
            act((node, doc) => {
              if (!["page", "panel", "fill"].includes(node.tagName))
                throw new Error("Add children to page/panel/slot fill");
              const n = doc.createElement(kind);
              let i = 1;
              while (doc.querySelector(`[id="new${i}"]`)) i++;
              n.setAttribute("id", `new${i}`);
              n.setAttribute("x", "24");
              n.setAttribute("y", "24");
              if (["text", "button"].includes(kind))
                n.setAttribute("text", "New " + kind);
              node.appendChild(n);
            })
          }
        >
          Add widget
        </button>
      </div>
      <div className="design-row">
        <select
          aria-label="Property name"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {[
            "text",
            "x",
            "y",
            "width",
            "height",
            "color",
            "bg",
            "fontSize",
            "font",
            "textKey",
            "direction",
            "gap",
            "padding",
            "radius",
            "navigate",
            "src",
            "hidden",
            "opacity",
          ].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input
          aria-label="Property value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          onClick={() =>
            act((n) => {
              if (value) n.setAttribute(key, value);
              else n.removeAttribute(key);
            })
          }
        >
          Set
        </button>
      </div>
      <h4>Binding</h4>
      <div className="design-row">
        <select
          aria-label="Binding property"
          value={binding}
          onChange={(e) => setBinding(e.target.value)}
        >
          {["text", "value", "checked", "hidden", "color", "quality"].map(
            (k) => (
              <option key={k}>{k}</option>
            ),
          )}
        </select>
        <select
          aria-label="Binding signal"
          value={signal}
          onChange={(e) => setSignal(e.target.value)}
        >
          {ir.signals.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={twoWay}
            onChange={(e) => setTwoWay(e.target.checked)}
          />
          Two-way
        </label>
        <button
          onClick={() =>
            child(
              "bind",
              {
                property: binding,
                signal,
                direction: twoWay ? "two-way" : "one-way",
              },
              (n) => n.getAttribute("property") === binding,
            )
          }
        >
          Apply binding
        </button>
      </div>
      <h4>Click command</h4>
      <div className="design-row">
        <select
          aria-label="Click command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        >
          {ir.commands.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={() => child("on", { event: "click", command }, () => true)}
        >
          Apply event
        </button>
      </div>
      <h4>Animation</h4>
      <div className="design-row">
        <select
          aria-label="Animated property"
          value={property}
          onChange={(e) => setProperty(e.target.value)}
        >
          {["x", "y", "opacity", "value"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input
          aria-label="Animation from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          aria-label="Animation to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <input
          aria-label="Duration milliseconds"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
        <button
          onClick={() =>
            child(
              "animate",
              {
                property,
                from,
                to,
                durationMs: duration,
                easing: "ease-in-out",
              },
              (n) => n.getAttribute("property") === property,
            )
          }
        >
          Apply animation
        </button>
      </div>
      <h4>Component / slot</h4>
      <ComponentTools source={source} selected={selected} act={act} />
      <h4>Move to parent</h4>
      <select
        aria-label="New parent"
        defaultValue=""
        onChange={(e) => {
          const parentId = e.target.value;
          act((n, doc) => {
            const parent = Array.from(doc.querySelectorAll("[id]")).find(
              (p) => p.getAttribute("id") === parentId,
            );
            if (!parent || n.contains(parent) || n.tagName === "page")
              throw new Error("Invalid parent");
            parent.appendChild(n);
          });
          e.target.value = "";
        }}
      >
        <option value="">Select page/panel…</option>
        {flatten(ir)
          .filter((n) => n.kind === "panel" && n.id !== selected)
          .map((n) => (
            <option key={n.id}>{n.id}</option>
          ))}
      </select>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function ComponentTools({
  source,
  selected,
  act,
}: {
  source: string;
  selected: string;
  act: (a: (node: Element, doc: Document) => void) => void;
}) {
  const [name, setName] = useState(""),
    [param, setParam] = useState(""),
    [value, setValue] = useState(""),
    [slot, setSlot] = useState("");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const components = Array.from(doc.querySelectorAll("component"));
  return (
    <>
      <div className="design-row">
        <select
          aria-label="Component template"
          value={name}
          onChange={(e) => setName(e.target.value)}
        >
          <option value="">Component…</option>
          {components.map((c) => (
            <option key={c.getAttribute("name")!}>
              {c.getAttribute("name")}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            act((node, doc) => {
              const n = doc.createElement("use");
              n.setAttribute("component", name);
              n.setAttribute("id", "instance" + Date.now());
              node.appendChild(n);
            })
          }
        >
          Insert use
        </button>
      </div>
      <div className="design-row">
        <input
          aria-label="Component parameter"
          placeholder="parameter"
          value={param}
          onChange={(e) => setParam(e.target.value)}
        />
        <input
          aria-label="Parameter value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          onClick={() =>
            act((n) => {
              if (n.tagName !== "use")
                throw new Error("Select a use node in XML");
              if (!/^[A-Za-z_]\w*$/.test(param))
                throw new Error("Invalid parameter");
              n.setAttribute(param, value);
            })
          }
        >
          Set parameter
        </button>
      </div>
      <div className="design-row">
        <input
          aria-label="Slot name"
          placeholder="slot name"
          value={slot}
          onChange={(e) => setSlot(e.target.value)}
        />
        <button
          onClick={() =>
            act((node, doc) => {
              if (node.tagName !== "use") throw new Error("Select a use node");
              if (!slot) throw new Error("Slot name required");
              const fill = doc.createElement("fill");
              fill.setAttribute("slot", slot);
              const panel = doc.createElement("panel");
              panel.setAttribute("id", "slotContent" + Date.now());
              fill.appendChild(panel);
              node.appendChild(fill);
            })
          }
        >
          Add slot fill
        </button>
      </div>
      <small>{selected}</small>
    </>
  );
}
