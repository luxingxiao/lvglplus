import { SaxesParser } from "saxes";
import type { XmlNode, Diagnostic } from "./types.js";

export function parseXml(
  source: string,
  file: string,
  diagnostics: Diagnostic[],
): XmlNode | undefined {
  const parser = new SaxesParser({ xmlns: false, position: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodeCount = 0;
  parser.on("doctype", () => {
    throw new Error("DOCTYPE and external entities are not supported");
  });
  parser.on("opentag", (tag) => {
    if (++nodeCount > 4096 || stack.length >= 64)
      throw new Error("XML exceeds 4096 elements or 64 nesting levels");
    const node: XmlNode = {
      tag: tag.name,
      attrs: tag.attributes as Record<string, string>,
      children: [],
      loc: {
        file,
        line: parser.line,
        column: Math.max(1, parser.column - tag.name.length),
      },
    };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", (text) => {
    if (text.trim())
      throw new Error('Use text="..." attributes, not inline text nodes');
  });
  parser.on("error", (error) => {
    throw error;
  });
  try {
    parser.write(source).close();
  } catch (error) {
    diagnostics.push({
      file,
      line: parser.line,
      column: parser.column,
      severity: "error",
      code: "XML_PARSE",
      message: String((error as Error).message),
    });
    return undefined;
  }
  return root;
}
