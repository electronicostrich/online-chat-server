import { readFileSync } from 'node:fs';

// Minimal markdown helpers — targeted at the docs in this repo, which use
// simple pipe tables and ATX headings (no cells with pipes inside code spans).
// Per docs/script-specs.md §2.3 we'd normally use remark, but the scripts need
// to run on Node without extra deps; these helpers are intentionally narrow.

export type Heading = { text: string; depth: number; line: number };
export type TableRow = { cells: string[]; line: number };
export type Section = { heading: Heading; lines: string[]; startLine: number; endLine: number };

type ParsedBlocks = {
  lines: string[];
  inCodeFence: boolean[];
};

function parseBlocks(content: string): ParsedBlocks {
  const lines = content.split('\n');
  const inCodeFence = new Array<boolean>(lines.length).fill(false);
  let fenceOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) {
      fenceOpen = !fenceOpen;
      inCodeFence[i] = true;
      continue;
    }
    inCodeFence[i] = fenceOpen;
  }
  return { lines, inCodeFence };
}

export function readMarkdown(filepath: string): string {
  return readFileSync(filepath, 'utf-8');
}

export function extractHeadings(content: string): Heading[] {
  const { lines, inCodeFence } = parseBlocks(content);
  const headings: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inCodeFence[i]) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i] ?? '');
    if (!m) continue;
    headings.push({ depth: (m[1] ?? '').length, text: (m[2] ?? '').trim(), line: i + 1 });
  }
  return headings;
}

export function extractTableRows(content: string): TableRow[] {
  const { lines, inCodeFence } = parseBlocks(content);
  const rows: TableRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (inCodeFence[i]) continue;
    const raw = (lines[i] ?? '').trim();
    if (!raw.startsWith('|') || !raw.endsWith('|')) continue;
    // Skip separator rows like | --- | --- |
    if (/^\|[\s:|-]+\|$/.test(raw)) continue;
    // Strip leading/trailing pipes, split.
    const inner = raw.slice(1, -1);
    const cells = inner.split('|').map((c) => c.trim());
    rows.push({ cells, line: i + 1 });
  }
  return rows;
}

export function extractSection(content: string, headingText: RegExp): Section | undefined {
  const headings = extractHeadings(content);
  const lines = content.split('\n');
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (!h) continue;
    if (!headingText.test(h.text)) continue;
    const next = headings.find((n, j) => j > i && n.depth <= h.depth);
    const startLine = h.line;
    const endLine = next ? next.line - 1 : lines.length;
    return {
      heading: h,
      lines: lines.slice(startLine, endLine),
      startLine,
      endLine,
    };
  }
  return undefined;
}

export function extractAcIds(content: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /\bAC-[A-Z]+-\d+\b/g;
  const { lines, inCodeFence } = parseBlocks(content);
  for (let i = 0; i < lines.length; i++) {
    if (inCodeFence[i]) continue;
    const line = lines[i] ?? '';
    for (const m of line.matchAll(pattern)) {
      ids.add(m[0]);
    }
  }
  return ids;
}
