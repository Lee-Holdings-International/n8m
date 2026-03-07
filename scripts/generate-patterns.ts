#!/usr/bin/env tsx
/**
 * generate-patterns.ts
 *
 * Scans ./workflows/ for all workflow.json files, calls AIService.generatePattern()
 * on each, and writes the result to ./docs/patterns/<slug>.md.
 *
 * Usage:
 *   npm run generate-patterns               # skip existing files
 *   npm run generate-patterns -- --overwrite  # overwrite all
 *   npm run generate-patterns -- --dry-run    # preview filenames only
 */

import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WORKFLOWS_DIR = path.join(ROOT, 'workflows');
const PATTERNS_DIR = path.join(ROOT, 'docs', 'patterns');

const overwrite = process.argv.includes('--overwrite');
const dryRun = process.argv.includes('--dry-run');

// ─── helpers ─────────────────────────────────────────────────────────────────

function findWorkflowFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findWorkflowFiles(full));
    } else if (entry === 'workflow.json') {
      results.push(full);
    }
  }
  return results;
}

function log(msg: string) { process.stdout.write(msg + '\n'); }
function ok(msg: string)  { log(`  ✓ ${msg}`); }
function skip(msg: string){ log(`  – ${msg}`); }
function fail(msg: string){ log(`  ✗ ${msg}`); }

// ─── main ────────────────────────────────────────────────────────────────────

const files = findWorkflowFiles(WORKFLOWS_DIR);

if (files.length === 0) {
  log('No workflow.json files found in ./workflows/');
  process.exit(0);
}

log(`\nFound ${files.length} workflow(s). Generating patterns...\n`);

if (!dryRun) {
  mkdirSync(PATTERNS_DIR, { recursive: true });
}

// Lazy-load AIService so the script only fails on AI calls, not on import
const { AIService } = await import('../src/services/ai.service.js');
const aiService = AIService.getInstance();

let generated = 0;
let skipped = 0;
let failed = 0;

for (const filePath of files) {
  const rel = path.relative(ROOT, filePath);
  log(`Processing: ${rel}`);

  let workflowJson: any;
  try {
    workflowJson = JSON.parse(await readFile(filePath, 'utf-8'));
  } catch {
    fail(`Could not parse ${rel}`);
    failed++;
    continue;
  }

  const name = workflowJson.name || path.basename(path.dirname(filePath));

  if (dryRun) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    skip(`[dry-run] would write docs/patterns/${slug}.md`);
    continue;
  }

  try {
    const { content, slug } = await aiService.generatePattern(workflowJson);
    const outPath = path.join(PATTERNS_DIR, `${slug}.md`);

    if (existsSync(outPath) && !overwrite) {
      skip(`docs/patterns/${slug}.md already exists (use --overwrite to replace)`);
      skipped++;
      continue;
    }

    writeFileSync(outPath, content, 'utf-8');
    ok(`docs/patterns/${slug}.md`);
    generated++;
  } catch (err) {
    fail(`Failed to generate pattern for "${name}": ${(err as Error).message}`);
    failed++;
  }
}

log(`\nDone. ${generated} generated, ${skipped} skipped, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
