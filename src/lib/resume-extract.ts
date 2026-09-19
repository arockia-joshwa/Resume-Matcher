/**
 * Server-only resume text extraction.
 *
 * Turns an uploaded PDF or DOCX into plain text so the existing
 * `analyzeResumeMatch` server function can keep receiving `resumeText`.
 *
 * Implemented with Node built-ins only (`node:zlib`) so no new runtime
 * dependency is added to the project:
 *   - DOCX: minimal ZIP reader -> `word/document.xml` -> text
 *   - PDF:  object scan -> FlateDecode -> content-stream text operators,
 *           decoded through each font's ToUnicode CMap / Differences map.
 *
 * Never import this from client code. It is loaded with a dynamic import
 * inside the server function handler so it stays out of the browser bundle.
 */

import { constants as zlibConstants, inflateSync, inflateRawSync } from "node:zlib";

export class ResumeExtractionError extends Error {}

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

/** Regex-group and index helpers that satisfy `noUncheckedIndexedAccess`. */
function group(match: RegExpMatchArray | RegExpExecArray, index: number): string {
  return match[index] ?? "";
}

function optionalGroup(
  match: RegExpMatchArray | RegExpExecArray,
  index: number,
): string | undefined {
  return match[index];
}

function byteAt(bytes: Uint8Array | number[], index: number): number {
  return bytes[index] ?? 0;
}

function charAt(text: string, index: number): string {
  return text[index] ?? "";
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITIES[body] ?? whole;
  });
}

/** Tidy whitespace without destroying the line structure of a resume. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\t\u00a0\u2007\u202f]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Byte-exact latin1 view of a buffer: string index === byte offset. */
function toLatin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/** Tolerant inflate: resume files are sometimes written without a clean end-of-stream. */
function inflate(data: Uint8Array, raw: boolean): Uint8Array {
  const options = { finishFlush: zlibConstants.Z_SYNC_FLUSH };
  try {
    return raw ? inflateRawSync(data, options) : inflateSync(data, options);
  } catch {
    // Some writers mislabel raw deflate as zlib (and vice versa).
    try {
      return raw ? inflateSync(data, options) : inflateRawSync(data, options);
    } catch {
      return new Uint8Array(0);
    }
  }
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

/** Read one file out of a ZIP archive by name. Returns null when absent. */
function readZipEntry(bytes: Uint8Array, wanted: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");

  // Locate the end-of-central-directory record (scanning backwards).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
    if (
      byteAt(bytes, i) === 0x50 &&
      byteAt(bytes, i + 1) === 0x4b &&
      byteAt(bytes, i + 2) === 0x05 &&
      byteAt(bytes, i + 3) === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  for (let index = 0; index < entryCount; index++) {
    if (pointer + 46 > bytes.length) return null;
    if (view.getUint32(pointer, true) !== 0x02014b50) return null;

    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    if (name === wanted) {
      if (localOffset + 30 > bytes.length) return null;
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd =
        compressedSize > 0 && compressedSize !== 0xffffffff
          ? dataStart + compressedSize
          : bytes.length;
      const slice = bytes.subarray(dataStart, Math.min(dataEnd, bytes.length));
      return method === 0 ? slice : inflate(slice, true);
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return null;
}

function docxXmlToText(xml: string): string {
  let out = "";
  const token =
    /<(?:w:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:)?t>|<(?:w:)?tab\b[^>]*>|<(?:w:)?(?:br|cr)\b[^>]*>|<\/(?:w:)?p>|<\/(?:w:)?tc>|<\/(?:w:)?tr>/g;

  let match: RegExpExecArray | null;
  while ((match = token.exec(xml)) !== null) {
    const chunk = match[0];
    if (match[1] !== undefined) out += decodeXmlEntities(match[1]);
    else if (/^<(?:w:)?tab/.test(chunk)) out += "\t";
    else if (/^<(?:w:)?(?:br|cr)/.test(chunk)) out += "\n";
    else if (/^<\/(?:w:)?tc>/.test(chunk)) out = `${out.replace(/\n+$/, "")} | `;
    else if (/^<\/(?:w:)?tr>/.test(chunk)) out = `${out.replace(/\s*\|\s*$/, "")}\n`;
    else out += "\n";
  }

  return out;
}

function extractDocxText(bytes: Uint8Array): string {
  const documentXml = readZipEntry(bytes, "word/document.xml");
  if (!documentXml || documentXml.length === 0) {
    throw new ResumeExtractionError(
      "That DOCX file could not be opened. Re-save it from Word or Google Docs and try again.",
    );
  }
  const xml = new TextDecoder("utf-8").decode(documentXml);
  return normalizeText(docxXmlToText(xml));
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

type PdfObject = { dict: string; stream: Uint8Array | null };

const WIN_ANSI_OVERRIDES: Record<number, string> = {
  0x80: "\u20ac",
  0x82: "\u201a",
  0x83: "\u0192",
  0x84: "\u201e",
  0x85: "\u2026",
  0x86: "\u2020",
  0x87: "\u2021",
  0x88: "\u02c6",
  0x89: "\u2030",
  0x8a: "\u0160",
  0x8b: "\u2039",
  0x8c: "\u0152",
  0x8e: "\u017d",
  0x91: "'",
  0x92: "'",
  0x93: '"',
  0x94: '"',
  0x95: "\u2022",
  0x96: "\u2013",
  0x97: "\u2014",
  0x98: "\u02dc",
  0x99: "\u2122",
  0x9a: "\u0161",
  0x9b: "\u203a",
  0x9c: "\u0153",
  0x9e: "\u017e",
  0x9f: "\u0178",
};

const GLYPH_NAMES: Record<string, string> = {
  space: " ",
  bullet: "\u2022",
  endash: "\u2013",
  emdash: "\u2014",
  quotesingle: "'",
  quotedbl: '"',
  quoteright: "'",
  quoteleft: "'",
  quotedblleft: '"',
  quotedblright: '"',
  hyphen: "-",
  period: ".",
  comma: ",",
  colon: ":",
  semicolon: ";",
  slash: "/",
  bar: "|",
  at: "@",
  ampersand: "&",
  percent: "%",
  plus: "+",
  parenleft: "(",
  parenright: ")",
  bracketleft: "[",
  bracketright: "]",
  fi: "fi",
  fl: "fl",
};

function glyphNameToText(name: string): string | null {
  if (GLYPH_NAMES[name]) return GLYPH_NAMES[name];
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (uni) return String.fromCharCode(Number.parseInt(group(uni, 1), 16));
  if (name.length === 1) return name;
  return null;
}

/** Scan every `N 0 obj ... endobj` block. Offsets in latin1 map 1:1 to bytes. */
function collectPdfObjects(bytes: Uint8Array, latin1: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const header = /(\d+)\s+(\d+)\s+obj\b/g;

  let match: RegExpExecArray | null;
  while ((match = header.exec(latin1)) !== null) {
    const number = Number.parseInt(group(match, 1), 10);
    const bodyStart = match.index + match[0].length;
    const bodyEnd = latin1.indexOf("endobj", bodyStart);
    if (bodyEnd < 0) continue;

    const body = latin1.slice(bodyStart, bodyEnd);
    const streamKeyword = /(^|[^a-zA-Z])stream\r?\n/.exec(body);

    if (!streamKeyword) {
      objects.set(number, { dict: body, stream: null });
      continue;
    }

    const dict = body.slice(0, streamKeyword.index);
    const dataStart = bodyStart + streamKeyword.index + streamKeyword[0].length;
    const endstream = latin1.lastIndexOf("endstream", bodyEnd);
    const dataEnd = endstream > dataStart ? endstream : bodyEnd;
    objects.set(number, { dict, stream: bytes.subarray(dataStart, dataEnd) });
  }

  return objects;
}

function ascii85Decode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple = 0;
  let count = 0;

  for (let i = 0; i < data.length; i++) {
    const char = byteAt(data, i);
    if (char === 0x7e) break; // "~" starts the EOD marker
    if (char <= 0x20 || char === 0x0a || char === 0x0d) continue;
    if (char === 0x7a && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (char < 0x21 || char > 0x75) continue;

    tuple = tuple * 85 + (char - 0x21);
    count++;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }

  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    const bytes = [(tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff];
    out.push(...bytes.slice(0, count - 1));
  }

  return Uint8Array.from(out);
}

function asciiHexDecode(data: Uint8Array): Uint8Array {
  const hex = (toLatin1(data).split(">")[0] ?? "").replace(/[^0-9A-Fa-f]/g, "");
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function runLengthDecode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const length = byteAt(data, i++);
    if (length === 128) break;
    if (length < 128) {
      for (let j = 0; j <= length; j++) out.push(byteAt(data, i++));
    } else {
      const byte = byteAt(data, i++);
      for (let j = 0; j < 257 - length; j++) out.push(byte);
    }
  }
  return Uint8Array.from(out);
}

/** Undo the PNG predictor used by cross-reference and object streams. */
function undoPngPredictor(data: Uint8Array, colors: number, columns: number): Uint8Array {
  const rowLength = colors * columns;
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);

  let previous = new Uint8Array(rowLength);
  for (let r = 0; r < rows; r++) {
    const tag = byteAt(data, r * (rowLength + 1));
    const row = data.subarray(r * (rowLength + 1) + 1, (r + 1) * (rowLength + 1));
    const current = new Uint8Array(rowLength);

    for (let i = 0; i < rowLength; i++) {
      const raw = byteAt(row, i);
      const left = i >= colors ? byteAt(current, i - colors) : 0;
      const up = byteAt(previous, i);
      const upLeft = i >= colors ? byteAt(previous, i - colors) : 0;
      let value = raw;
      if (tag === 1) value = raw + left;
      else if (tag === 2) value = raw + up;
      else if (tag === 3) value = raw + ((left + up) >> 1);
      else if (tag === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      current[i] = value & 0xff;
    }

    out.set(current, r * rowLength);
    previous = current;
  }

  return out;
}

const TEXT_FILTERS = new Set([
  "FlateDecode",
  "Fl",
  "ASCII85Decode",
  "A85",
  "ASCIIHexDecode",
  "AHx",
  "RunLengthDecode",
  "RL",
]);

function decodeStream(object: PdfObject): Uint8Array {
  if (!object.stream) return new Uint8Array(0);

  const filterValue = dictValue(object.dict, "Filter");
  if (!filterValue) return object.stream;

  const filters = [...filterValue.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => group(m, 1));
  if (filters.some((filter) => !TEXT_FILTERS.has(filter))) return new Uint8Array(0);

  let data = object.stream;
  for (const filter of filters) {
    if (filter === "ASCII85Decode" || filter === "A85") data = ascii85Decode(data);
    else if (filter === "ASCIIHexDecode" || filter === "AHx") data = asciiHexDecode(data);
    else if (filter === "RunLengthDecode" || filter === "RL") data = runLengthDecode(data);
    else data = inflate(data, false);
    if (!data.length) return data;
  }

  const parms = dictValue(object.dict, "DecodeParms") ?? dictValue(object.dict, "DP");
  if (parms) {
    const predictor = Number.parseInt(dictValue(parms, "Predictor") ?? "1", 10);
    if (predictor >= 10) {
      const colors = Number.parseInt(dictValue(parms, "Colors") ?? "1", 10);
      const columns = Number.parseInt(dictValue(parms, "Columns") ?? "1", 10);
      const bits = Number.parseInt(dictValue(parms, "BitsPerComponent") ?? "8", 10);
      if (bits === 8) data = undoPngPredictor(data, colors, columns);
    }
  }

  return data;
}

function resolve(objects: Map<number, PdfObject>, value: string | undefined): PdfObject | null {
  if (!value) return null;
  const ref = /^\s*(\d+)\s+\d+\s+R/.exec(value);
  if (!ref) return null;
  return objects.get(Number.parseInt(group(ref, 1), 10)) ?? null;
}

/** Pull `/Key <value>` out of a dictionary string, balancing <<>> and []. */
function dictValue(dict: string, key: string): string | undefined {
  const at = new RegExp(`/${key}\\b`).exec(dict);
  if (!at) return undefined;
  let index = at.index + at[0].length;
  while (index < dict.length && /\s/.test(charAt(dict, index))) index++;

  if (dict.startsWith("<<", index)) {
    let depth = 0;
    for (let i = index; i < dict.length - 1; i++) {
      if (dict.startsWith("<<", i)) depth++;
      else if (dict.startsWith(">>", i)) {
        depth--;
        if (depth === 0) return dict.slice(index, i + 2);
      }
    }
    return dict.slice(index);
  }

  if (charAt(dict, index) === "[") {
    let depth = 0;
    for (let i = index; i < dict.length; i++) {
      if (charAt(dict, i) === "[") depth++;
      else if (charAt(dict, i) === "]") {
        depth--;
        if (depth === 0) return dict.slice(index, i + 1);
      }
    }
    return dict.slice(index);
  }

  const rest = dict.slice(index);
  const ref = /^\d+\s+\d+\s+R/.exec(rest);
  if (ref) return ref[0];
  const name = /^\/[^\s/<>[\]()]*/.exec(rest);
  if (name) return name[0];
  const simple = /^[^/\s\]>]+/.exec(rest);
  return simple ? simple[0] : undefined;
}

/** Objects compressed inside /ObjStm containers are invisible to the plain scan. */
function expandObjectStreams(objects: Map<number, PdfObject>) {
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(object.dict)) continue;

    const data = decodeStream(object);
    if (!data.length) continue;

    const text = toLatin1(data);
    const count = Number.parseInt(dictValue(object.dict, "N") ?? "0", 10);
    const first = Number.parseInt(dictValue(object.dict, "First") ?? "0", 10);
    if (!count || !first) continue;

    const pairs = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i++) {
      const number = pairs[i * 2] ?? Number.NaN;
      const offset = pairs[i * 2 + 1] ?? Number.NaN;
      if (!Number.isFinite(number) || !Number.isFinite(offset)) continue;
      if (objects.has(number)) continue;
      const nextOffset = pairs[i * 2 + 3];
      const end = i + 1 < count && nextOffset !== undefined ? first + nextOffset : text.length;
      objects.set(number, { dict: text.slice(first + offset, end), stream: null });
    }
  }
}

function orderedPages(objects: Map<number, PdfObject>): PdfObject[] {
  const pages: PdfObject[] = [];
  const seen = new Set<PdfObject>();

  const walk = (node: PdfObject | null, depth: number) => {
    if (!node || seen.has(node) || depth > 64) return;
    seen.add(node);
    if (/\/Type\s*\/Page\b/.test(node.dict)) {
      pages.push(node);
      return;
    }
    const kids = dictValue(node.dict, "Kids");
    if (!kids) return;
    for (const kid of kids.matchAll(/(\d+)\s+\d+\s+R/g)) {
      const child = objects.get(Number.parseInt(group(kid, 1), 10));
      if (!child) continue;
      // Pages nodes inherit /Resources to their children.
      if (!dictValue(child.dict, "Resources")) {
        const inherited = dictValue(node.dict, "Resources");
        if (inherited) child.dict += `\n/Resources ${inherited}`;
      }
      walk(child, depth + 1);
    }
  };

  for (const object of objects.values()) {
    if (/\/Type\s*\/Catalog/.test(object.dict)) {
      walk(resolve(objects, dictValue(object.dict, "Pages")), 0);
      break;
    }
  }

  if (pages.length) return pages;
  return [...objects.entries()]
    .filter(([, object]) => /\/Type\s*\/Page\b/.test(object.dict))
    .sort((a, b) => a[0] - b[0])
    .map(([, object]) => object);
}

type FontDecoder = { bytesPerCode: number; map: Map<number, string> | null; differences: Map<number, string> | null };

function parseCMap(text: string): { map: Map<number, string>; bytesPerCode: number } {
  const map = new Map<number, string>();
  let bytesPerCode = 1;

  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (codespace) {
    const first = /<([0-9A-Fa-f]+)>/.exec(group(codespace, 1));
    if (first && group(first, 1).length >= 4) bytesPerCode = 2;
  }

  const hexToString = (hex: string) => {
    let out = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = Number.parseInt(hex.slice(i, i + 4), 16);
      if (Number.isFinite(code) && code !== 0) out += String.fromCharCode(code);
    }
    return out;
  };

  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of group(block, 1).matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      if (group(entry, 1).length >= 4) bytesPerCode = 2;
      map.set(Number.parseInt(group(entry, 1), 16), hexToString(group(entry, 2)));
    }
  }

  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = group(block, 1);
    const line = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([\s\S]*?)\])/g;
    for (const entry of body.matchAll(line)) {
      const low = Number.parseInt(group(entry, 1), 16);
      const high = Number.parseInt(group(entry, 2), 16);
      if (group(entry, 1).length >= 4) bytesPerCode = 2;
      if (!Number.isFinite(low) || !Number.isFinite(high) || high - low > 65535) continue;

      const direct = optionalGroup(entry, 3);
      const list = optionalGroup(entry, 4);
      if (direct !== undefined) {
        const base = hexToString(direct);
        const lastCharCode = base.length ? base.charCodeAt(base.length - 1) : 0;
        for (let code = low; code <= high; code++) {
          const shifted = base.slice(0, -1) + String.fromCharCode(lastCharCode + (code - low));
          map.set(code, shifted);
        }
      } else if (list !== undefined) {
        const items = [...list.matchAll(/<([0-9A-Fa-f]*)>/g)];
        items.forEach((item, offset) => map.set(low + offset, hexToString(group(item, 1))));
      }
    }
  }

  return { map, bytesPerCode };
}

function buildFontDecoders(
  objects: Map<number, PdfObject>,
  resources: string | undefined,
): Map<string, FontDecoder> {
  const decoders = new Map<string, FontDecoder>();
  if (!resources) return decoders;

  // /Resources is often an indirect reference rather than an inline dictionary.
  const resourcesObject = resolve(objects, resources);
  const resourcesDict = resourcesObject ? resourcesObject.dict : resources;

  let fontDict = dictValue(resourcesDict, "Font");
  const referenced = resolve(objects, fontDict);
  if (referenced) fontDict = referenced.dict;
  if (!fontDict) return decoders;

  for (const entry of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const font = objects.get(Number.parseInt(group(entry, 2), 10));
    if (!font) continue;

    let bytesPerCode = /\/Subtype\s*\/Type0/.test(font.dict) ? 2 : 1;
    let map: Map<number, string> | null = null;

    const toUnicode = resolve(objects, dictValue(font.dict, "ToUnicode"));
    if (toUnicode) {
      const parsed = parseCMap(toLatin1(decodeStream(toUnicode)));
      if (parsed.map.size) {
        map = parsed.map;
        bytesPerCode = parsed.bytesPerCode;
      }
    }

    let differences: Map<number, string> | null = null;
    let encoding = dictValue(font.dict, "Encoding");
    const encodingObject = resolve(objects, encoding);
    if (encodingObject) encoding = encodingObject.dict;
    const diffArray = encoding ? dictValue(encoding, "Differences") : undefined;
    if (diffArray) {
      differences = new Map();
      let code = 0;
      for (const token of diffArray.matchAll(/(\d+)|\/([^\s/\]]+)/g)) {
        const numeric = optionalGroup(token, 1);
        if (numeric !== undefined) code = Number.parseInt(numeric, 10);
        else {
          const glyph = glyphNameToText(group(token, 2));
          if (glyph) differences.set(code, glyph);
          code++;
        }
      }
    }

    decoders.set(group(entry, 1), { bytesPerCode, map, differences });
  }

  return decoders;
}

function decodeShownString(raw: number[], decoder: FontDecoder | undefined): string {
  if (!decoder) return raw.map((byte) => WIN_ANSI_OVERRIDES[byte] ?? String.fromCharCode(byte)).join("");

  let out = "";
  const step = decoder.bytesPerCode;
  for (let i = 0; i < raw.length; i += step) {
    const code = step === 2 ? (byteAt(raw, i) << 8) | byteAt(raw, i + 1) : byteAt(raw, i);
    const mapped = decoder.map?.get(code);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const different = decoder.differences?.get(code);
    if (different !== undefined) {
      out += different;
      continue;
    }
    out += step === 2 ? "" : (WIN_ANSI_OVERRIDES[code] ?? String.fromCharCode(code));
  }
  return out;
}

/** Walk a page content stream and rebuild its visible text, line by line. */
function readContentStream(content: string, fonts: Map<string, FontDecoder>): string {
  let out = "";
  let operands: Array<{ kind: "num" | "name" | "str" | "array"; value: unknown }> = [];
  let font: FontDecoder | undefined;
  let leading = 0;
  let x = 0;
  let y = 0;
  let lastX: number | null = null;
  let lastY: number | null = null;

  const readLiteral = (start: number): [number[], number] => {
    const bytes: number[] = [];
    let depth = 1;
    let i = start;
    while (i < content.length) {
      const char = charAt(content, i);
      if (char === "\\") {
        const next = charAt(content, i + 1);
        const octal = /^[0-7]{1,3}/.exec(content.slice(i + 1, i + 4));
        if (octal) {
          bytes.push(Number.parseInt(octal[0], 8) & 0xff);
          i += 1 + octal[0].length;
          continue;
        }
        const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        if (next === "\n") i += 2;
        else {
          bytes.push(escapes[next] ?? next.charCodeAt(0));
          i += 2;
        }
        continue;
      }
      if (char === "(") depth++;
      else if (char === ")") {
        depth--;
        if (depth === 0) return [bytes, i + 1];
      }
      bytes.push(char.charCodeAt(0) & 0xff);
      i++;
    }
    return [bytes, i];
  };

  const show = (bytes: number[]) => {
    out += decodeShownString(bytes, font);
  };

  const showArray = (items: Array<number | number[]>) => {
    for (const item of items) {
      if (typeof item === "number") {
        if (item < -100) out += " ";
      } else {
        show(item);
      }
    }
  };

  const newLineIfMoved = () => {
    if (lastY === null) {
      lastY = y;
      lastX = x;
      return;
    }
    if (Math.abs(y - lastY) > 1.5) {
      out = out.replace(/[ ]+$/, "");
      if (!out.endsWith("\n")) out += "\n";
    } else if (lastX !== null && x - lastX > 4) {
      out += " ";
    }
    lastY = y;
    lastX = x;
  };

  let i = 0;
  while (i < content.length) {
    const char = charAt(content, i);

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === "(") {
      const [bytes, next] = readLiteral(i + 1);
      operands.push({ kind: "str", value: bytes });
      i = next;
      continue;
    }

    if (char === "<" && charAt(content, i + 1) !== "<") {
      const end = content.indexOf(">", i);
      const hex = content.slice(i + 1, end < 0 ? content.length : end).replace(/[^0-9A-Fa-f]/g, "");
      const bytes: number[] = [];
      for (let h = 0; h < hex.length; h += 2) bytes.push(Number.parseInt(hex.slice(h, h + 2).padEnd(2, "0"), 16));
      operands.push({ kind: "str", value: bytes });
      i = end < 0 ? content.length : end + 1;
      continue;
    }

    if (char === "<" && charAt(content, i + 1) === "<") {
      let depth = 0;
      let j = i;
      for (; j < content.length - 1; j++) {
        if (content.startsWith("<<", j)) depth++;
        else if (content.startsWith(">>", j)) {
          depth--;
          if (depth === 0) {
            j += 2;
            break;
          }
        }
      }
      i = j;
      continue;
    }

    if (char === "[") {
      const items: Array<number | number[]> = [];
      let j = i + 1;
      while (j < content.length && charAt(content, j) !== "]") {
        if (charAt(content, j) === "(") {
          const [bytes, next] = readLiteral(j + 1);
          items.push(bytes);
          j = next;
          continue;
        }
        if (charAt(content, j) === "<") {
          const end = content.indexOf(">", j);
          const hex = content.slice(j + 1, end < 0 ? content.length : end).replace(/[^0-9A-Fa-f]/g, "");
          const bytes: number[] = [];
          for (let h = 0; h < hex.length; h += 2)
            bytes.push(Number.parseInt(hex.slice(h, h + 2).padEnd(2, "0"), 16));
          items.push(bytes);
          j = end < 0 ? content.length : end + 1;
          continue;
        }
        const number = /^-?\d*\.?\d+/.exec(content.slice(j));
        if (number) {
          items.push(Number.parseFloat(number[0]));
          j += number[0].length;
          continue;
        }
        j++;
      }
      operands.push({ kind: "array", value: items });
      i = j + 1;
      continue;
    }

    if (char === "/") {
      const name = /^\/([^\s/<>[\]()]*)/.exec(content.slice(i));
      operands.push({ kind: "name", value: name ? name[1] : "" });
      i += name ? name[0].length : 1;
      continue;
    }

    const number = /^[-+]?\d*\.?\d+/.exec(content.slice(i));
    if (number && /[\d+\-.]/.test(char)) {
      operands.push({ kind: "num", value: Number.parseFloat(number[0]) });
      i += number[0].length;
      continue;
    }

    const operator = /^[A-Za-z'"*]+[01*]?/.exec(content.slice(i));
    if (!operator) {
      i++;
      continue;
    }
    const op = operator[0];
    i += op.length;

    const numbers = operands.filter((o) => o.kind === "num").map((o) => o.value as number);

    switch (op) {
      case "BT":
        x = 0;
        y = 0;
        lastX = null;
        lastY = null;
        break;
      case "ET":
        out = out.replace(/[ ]+$/, "");
        if (!out.endsWith("\n")) out += "\n";
        lastX = null;
        lastY = null;
        break;
      case "Tf": {
        const name = operands.find((o) => o.kind === "name");
        if (name) font = fonts.get(name.value as string);
        break;
      }
      case "TL":
        leading = numbers[0] ?? leading;
        break;
      case "Td":
        x += numbers[0] ?? 0;
        y += numbers[1] ?? 0;
        newLineIfMoved();
        break;
      case "TD":
        x += numbers[0] ?? 0;
        y += numbers[1] ?? 0;
        leading = -(numbers[1] ?? 0);
        newLineIfMoved();
        break;
      case "Tm":
        x = numbers[4] ?? 0;
        y = numbers[5] ?? 0;
        newLineIfMoved();
        break;
      case "T*":
        y -= leading;
        newLineIfMoved();
        break;
      case "Tj":
      case "TJ":
      case "'":
      case '"': {
        if (op === "'" || op === '"') {
          y -= leading;
          newLineIfMoved();
        }
        const array = operands.find((o) => o.kind === "array");
        const string = [...operands].reverse().find((o) => o.kind === "str");
        if (op === "TJ" && array) showArray(array.value as Array<number | number[]>);
        else if (string) show(string.value as number[]);
        break;
      }
      default:
        break;
    }

    operands = [];
  }

  return out;
}

function extractPdfText(bytes: Uint8Array): string {
  const latin1 = toLatin1(bytes);
  if (!latin1.startsWith("%PDF")) {
    throw new ResumeExtractionError("That file isn't a valid PDF. Try re-exporting it.");
  }
  if (/\/Encrypt\b/.test(latin1)) {
    throw new ResumeExtractionError(
      "That PDF is password protected. Remove the protection, or upload a DOCX instead.",
    );
  }

  const objects = collectPdfObjects(bytes, latin1);
  expandObjectStreams(objects);

  const pages = orderedPages(objects);
  const chunks: string[] = [];

  for (const page of pages.slice(0, 40)) {
    const fonts = buildFontDecoders(objects, dictValue(page.dict, "Resources"));
    const contents = dictValue(page.dict, "Contents") ?? "";
    const streams: string[] = [];

    for (const ref of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
      const object = objects.get(Number.parseInt(group(ref, 1), 10));
      if (!object) continue;
      streams.push(toLatin1(decodeStream(object)));
    }

    const text = readContentStream(streams.join("\n"), fonts);
    if (text.trim()) chunks.push(text);
  }

  return normalizeText(chunks.join("\n\n"));
}

/* ------------------------------------------------------------------ *
 * public entry point
 * ------------------------------------------------------------------ */

/** Rough guard against image-only PDFs and undecodable font encodings. */
function looksLikeReadableText(text: string): boolean {
  if (text.length < 150) return false;
  const letters = text.replace(/[^A-Za-z]/g, "").length;
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word)).length;
  return letters / text.length > 0.35 && words >= 25;
}

export type ExtractedResume = { text: string; characters: number; words: number };

export async function extractResumeText(file: File): Promise<ExtractedResume> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  const isPdf = name.endsWith(".pdf") || file.type === "application/pdf";

  const text = isPdf ? extractPdfText(bytes) : extractDocxText(bytes);

  if (!looksLikeReadableText(text)) {
    throw new ResumeExtractionError(
      isPdf
        ? "We couldn't read any text from that PDF — it looks scanned or image-based. Export a text-based PDF from Word or Google Docs, or upload a DOCX."
        : "We couldn't read enough text from that document. Re-save it as a .docx or export it as a PDF and try again.",
    );
  }

  return {
    text,
    characters: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}
