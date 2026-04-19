// lint-compose — closes #3. Compose ↔ .env.example ↔ docs consistency per
// docs/script-specs.md §5 and docs/runtime-and-environment.md. Invoked by
// `pnpm lint-compose` and (optionally) CI.
//
// Checks:
//   1. services-match        — services declared in compose.yaml match docs §2
//   2. images-digest-pinned  — every image reference has an @sha256: digest
//   3. healthchecks-present  — every service in docs §4 has healthcheck: in compose
//   4. volumes-match         — top-level volumes match docs §3
//   5. compose-env-vars-declared — every ${VAR} referenced by compose.yaml is declared in .env.example
//   6. env-example-documented    — every key in .env.example appears in docs §6
//
// We intentionally don't take a hard YAML dependency (tsx lets us use Node
// builtins only); compose.yaml follows a narrow subset we parse directly.
// If the compose schema shape diverges, the regex parsers below need updating.
//
// Exit codes: 0 = clean, 1 = violations, 2 = error.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckResult } from './_lib/report.js';
import { hasJsonFlag, report } from './_lib/report.js';
import { extractSection, extractTableRows } from './_lib/markdown.js';

const REPO = process.cwd();

function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

type ParsedCompose = {
  services: Map<string, ServiceBlock>;
  volumes: Set<string>;
  referencedEnvVars: Set<string>;
};

type ServiceBlock = {
  name: string;
  image?: string;
  hasHealthcheck: boolean;
  envKeys: Set<string>; // keys declared in the service's `environment:` block
  raw: string;
};

// Very narrow compose.yaml parser, tolerant of 2-space indented maps and the
// patterns used in this repo. It does not support all compose syntax — the
// goal is rule enforcement, not general YAML parsing.
function parseCompose(path: string): ParsedCompose | undefined {
  const text = readTextIfExists(path);
  if (text === undefined) return undefined;

  const services = new Map<string, ServiceBlock>();
  const volumes = new Set<string>();
  const referencedEnvVars = new Set<string>();

  // Capture every ${VAR...} reference across the whole file.
  for (const m of text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(?::[-?][^}]*)?\}/g)) {
    referencedEnvVars.add(m[1] ?? '');
  }

  // Break the file into top-level sections on 0-indent headings ending in ":".
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const topHeading = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*$/.exec(line);
    if (!topHeading) {
      i++;
      continue;
    }
    const key = topHeading[1] ?? '';
    const start = i + 1;
    let end = lines.length;
    for (let j = start; j < lines.length; j++) {
      if (/^[a-zA-Z_]/.test(lines[j] ?? '')) {
        end = j;
        break;
      }
    }
    const block = lines.slice(start, end).join('\n');

    if (key === 'services') {
      parseServices(block, services);
    } else if (key === 'volumes') {
      parseVolumes(block, volumes);
    }

    i = end;
  }

  return { services, volumes, referencedEnvVars };
}

function parseServices(block: string, out: Map<string, ServiceBlock>): void {
  // Split into per-service sections (2-space indented headings).
  const lines = block.split('\n');
  const starts: { name: string; start: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {2}([a-zA-Z_][a-zA-Z0-9_-]*):\s*$/.exec(lines[i] ?? '');
    if (m) starts.push({ name: m[1] ?? '', start: i });
  }
  for (let idx = 0; idx < starts.length; idx++) {
    const { name, start } = starts[idx] as { name: string; start: number };
    const end = starts[idx + 1]?.start ?? lines.length;
    const raw = lines.slice(start, end).join('\n');

    const image = /^ {4}image:\s*(.+)$/m.exec(raw)?.[1]?.trim();
    const hasHealthcheck = / {4}healthcheck:\s*$/m.test(raw);

    const envKeys = new Set<string>();
    // environment: can be a map (lines of "KEY: value") or a list (lines of "- KEY=value"|"- KEY").
    const envSectionMatch = / {4}environment:\s*\n((?: {6,}[^\n]+\n?)+)/m.exec(raw);
    if (envSectionMatch) {
      const envBody = envSectionMatch[1] ?? '';
      for (const envLine of envBody.split('\n')) {
        const trimmed = envLine.trim();
        if (trimmed.length === 0) continue;
        // map form
        const mapForm = /^([A-Z_][A-Z0-9_]*)\s*:/.exec(trimmed);
        if (mapForm) {
          envKeys.add(mapForm[1] ?? '');
          continue;
        }
        // list form: "- KEY=value" or "- KEY"
        const listForm = /^-\s*([A-Z_][A-Z0-9_]*)(?:=|$)/.exec(trimmed);
        if (listForm) {
          envKeys.add(listForm[1] ?? '');
        }
      }
    }

    out.set(name, { name, ...(image !== undefined ? { image } : {}), hasHealthcheck, envKeys, raw });
  }
}

function parseVolumes(block: string, out: Set<string>): void {
  for (const line of block.split('\n')) {
    const m = /^ {2}([a-zA-Z_][a-zA-Z0-9_-]*):\s*$/.exec(line);
    if (m) out.add(m[1] ?? '');
  }
}

function parseEnvExampleKeys(path: string): Set<string> | undefined {
  const text = readTextIfExists(path);
  if (text === undefined) return undefined;
  const keys = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=/.exec(line.trim());
    if (m) keys.add(m[1] ?? '');
  }
  return keys;
}

type DocsExpectations = {
  serviceNames: Set<string>;
  servicesWithHealthcheck: Set<string>;
  volumeNames: Set<string>;
  envKeysDocumented: Set<string>;
};

function parseRuntimeDocs(path: string): DocsExpectations | undefined {
  const content = readTextIfExists(path);
  if (content === undefined) return undefined;

  const serviceNames = new Set<string>();
  const servicesWithHealthcheck = new Set<string>();
  const volumeNames = new Set<string>();
  const envKeysDocumented = new Set<string>();

  const services = extractSection(content, /^2\.\s+Services$/);
  if (services) {
    for (const row of extractTableRows(services.lines.join('\n'))) {
      const first = stripBackticks(row.cells[0] ?? '');
      if (first.length > 0 && first !== 'Service') serviceNames.add(first);
    }
  }

  const vols = extractSection(content, /^3\.\s+Volumes$/);
  if (vols) {
    for (const row of extractTableRows(vols.lines.join('\n'))) {
      const first = stripBackticks(row.cells[0] ?? '');
      if (first.length > 0 && first !== 'Volume') volumeNames.add(first);
    }
  }

  const health = extractSection(content, /^4\.\s+Service dependencies and health checks$/);
  if (health) {
    for (const row of extractTableRows(health.lines.join('\n'))) {
      const first = stripBackticks(row.cells[0] ?? '');
      if (first.length > 0 && first !== 'Service') servicesWithHealthcheck.add(first);
    }
  }

  // §6.1..6.5 — env var keys.
  const envSections = [
    /^6\.1\s+Backend.*/,
    /^6\.2\s+Frontend.*/,
    /^6\.3\s+PostgreSQL.*/,
    /^6\.4\s+Redis.*/,
    /^6\.5\s+Mail sink.*/,
  ];
  for (const heading of envSections) {
    const sec = extractSection(content, heading);
    if (!sec) continue;
    for (const row of extractTableRows(sec.lines.join('\n'))) {
      const first = stripBackticks(row.cells[0] ?? '');
      if (/^[A-Z_][A-Z0-9_]*$/.test(first)) envKeysDocumented.add(first);
    }
  }

  return { serviceNames, servicesWithHealthcheck, volumeNames, envKeysDocumented };
}

function stripBackticks(cell: string): string {
  return cell.replace(/`/g, '').trim();
}

const argv = process.argv.slice(2);
const json = hasJsonFlag(argv);
const checks: CheckResult[] = [];
const errors: string[] = [];

const compose = parseCompose(resolve(REPO, 'compose.yaml'));
const envExampleKeys = parseEnvExampleKeys(resolve(REPO, '.env.example'));
const docs = parseRuntimeDocs(resolve(REPO, 'docs/runtime-and-environment.md'));

if (!compose) errors.push('cannot read compose.yaml');
if (!envExampleKeys) errors.push('cannot read .env.example');
if (!docs) errors.push('cannot read docs/runtime-and-environment.md');

if (compose && docs) {
  const composeServices = new Set(compose.services.keys());
  const missingInCompose = [...docs.serviceNames].filter((s) => !composeServices.has(s));
  const extraInCompose = [...composeServices].filter((s) => !docs.serviceNames.has(s));
  checks.push({
    name: 'services-match',
    status: missingInCompose.length === 0 && extraInCompose.length === 0 ? 'pass' : 'fail',
    details:
      missingInCompose.length === 0 && extraInCompose.length === 0
        ? `${String(composeServices.size)} services match docs §2`
        : [
            missingInCompose.length > 0 ? `missing in compose: ${missingInCompose.join(', ')}` : '',
            extraInCompose.length > 0 ? `extra in compose: ${extraInCompose.join(', ')}` : '',
          ]
            .filter((s) => s.length > 0)
            .join('; '),
  });

  // images-digest-pinned — every `image:` referenced (services with image:
  // only — build: targets are exempt) must have @sha256: form.
  const unpinned: string[] = [];
  for (const svc of compose.services.values()) {
    if (svc.image === undefined) continue;
    if (!/@sha256:[a-f0-9]{64}$/.test(svc.image)) {
      unpinned.push(`${svc.name}: ${svc.image}`);
    }
  }
  checks.push({
    name: 'images-digest-pinned',
    status: unpinned.length === 0 ? 'pass' : 'fail',
    details:
      unpinned.length === 0
        ? 'every image pinned to a sha256 digest'
        : `image(s) missing @sha256:<64-hex> pin: ${unpinned.join('; ')}`,
  });

  // healthchecks-present — docs §4 lists the services that must have healthchecks.
  const missingHealth: string[] = [];
  for (const svcName of docs.servicesWithHealthcheck) {
    const svc = compose.services.get(svcName);
    if (!svc) continue; // services-match already flagged it
    if (!svc.hasHealthcheck) missingHealth.push(svcName);
  }
  checks.push({
    name: 'healthchecks-present',
    status: missingHealth.length === 0 ? 'pass' : 'fail',
    details:
      missingHealth.length === 0
        ? 'every docs §4 service has a healthcheck block in compose.yaml'
        : `service(s) missing healthcheck: ${missingHealth.join(', ')}`,
  });

  // volumes-match
  const missingVol = [...docs.volumeNames].filter((v) => !compose.volumes.has(v));
  const extraVol = [...compose.volumes].filter((v) => !docs.volumeNames.has(v));
  checks.push({
    name: 'volumes-match',
    status: missingVol.length === 0 && extraVol.length === 0 ? 'pass' : 'fail',
    details:
      missingVol.length === 0 && extraVol.length === 0
        ? `${String(compose.volumes.size)} volumes match docs §3`
        : [
            missingVol.length > 0 ? `missing in compose: ${missingVol.join(', ')}` : '',
            extraVol.length > 0 ? `extra in compose: ${extraVol.join(', ')}` : '',
          ]
            .filter((s) => s.length > 0)
            .join('; '),
  });
}

if (compose && envExampleKeys) {
  const missingInEnv = [...compose.referencedEnvVars].filter((v) => !envExampleKeys.has(v));
  checks.push({
    name: 'compose-env-vars-declared',
    status: missingInEnv.length === 0 ? 'pass' : 'fail',
    details:
      missingInEnv.length === 0
        ? `every ${String(compose.referencedEnvVars.size)} compose.yaml \${VAR} is in .env.example`
        : `referenced in compose.yaml but absent from .env.example: ${missingInEnv.join(', ')}`,
  });
}

if (envExampleKeys && docs) {
  const undocumented = [...envExampleKeys].filter((k) => !docs.envKeysDocumented.has(k));
  checks.push({
    name: 'env-example-documented',
    status: undocumented.length === 0 ? 'pass' : 'fail',
    details:
      undocumented.length === 0
        ? `every .env.example key documented in docs/runtime-and-environment.md §6`
        : `key(s) in .env.example not documented in §6: ${undocumented.join(', ')}`,
  });
}

report('lint-compose', checks, { json, errors });
