import fs from 'fs/promises';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

export interface WorkflowFixture {
  version: '1.0';
  capturedAt: string;
  workflowId: string;
  workflowName: string;
  /** Human-readable label for this test case */
  description?: string;
  /** Whether this case should pass or fail. Defaults to 'pass'. */
  expectedOutcome?: 'pass' | 'fail';
  workflow: any;
  execution: {
    id?: string;
    status: string;
    startedAt?: string;
    data: {
      resultData: {
        error?: any;
        runData: Record<string, any[]>;
      };
    };
  };
}

export class FixtureManager {
  private fixturesDir: string;

  constructor() {
    this.fixturesDir = path.join(process.cwd(), '.n8m', 'fixtures');
  }

  private fixturePath(workflowId: string): string {
    return path.join(this.fixturesDir, `${workflowId}.json`);
  }

  private fixtureDir(workflowId: string): string {
    return path.join(this.fixturesDir, workflowId);
  }

  exists(workflowId: string): boolean {
    return existsSync(this.fixturePath(workflowId)) || existsSync(this.fixtureDir(workflowId));
  }

  /** Load all fixtures for a workflow. Supports both directory (new) and single-file (legacy) formats. */
  loadAll(workflowId: string): WorkflowFixture[] {
    const dir = this.fixtureDir(workflowId);
    if (existsSync(dir)) {
      return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .flatMap(f => {
          try {
            const raw = readFileSync(path.join(dir, f), 'utf-8');
            return [JSON.parse(raw) as WorkflowFixture];
          } catch {
            return [];
          }
        });
    }
    // Legacy single-file fallback
    const single = this.load(workflowId);
    return single ? [single] : [];
  }

  load(workflowId: string): WorkflowFixture | null {
    try {
      const raw = readFileSync(this.fixturePath(workflowId), 'utf-8');
      return JSON.parse(raw) as WorkflowFixture;
    } catch {
      return null;
    }
  }

  loadFromPath(filePath: string): WorkflowFixture | null {
    try {
      const raw = readFileSync(path.resolve(filePath), 'utf-8');
      return JSON.parse(raw) as WorkflowFixture;
    } catch {
      return null;
    }
  }

  getCapturedDate(workflowId: string): Date | null {
    const fixtures = this.loadAll(workflowId);
    if (fixtures.length === 0) return null;
    const dates = fixtures
      .map(f => new Date(f.capturedAt))
      .filter(d => !isNaN(d.getTime()));
    if (dates.length === 0) return null;
    return dates.reduce((latest, d) => (d > latest ? d : latest));
  }

  /** Save a named fixture into the per-workflow directory (new multi-fixture format). */
  async saveNamed(fixture: WorkflowFixture, name: string): Promise<void> {
    const dir = this.fixtureDir(fixture.workflowId);
    await fs.mkdir(dir, { recursive: true });
    const safeName = name.replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').toLowerCase();
    await fs.writeFile(
      path.join(dir, `${safeName}.json`),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    );
  }

  /** Legacy single-file save (used by offerSaveFixture after live runs). */
  async save(fixture: WorkflowFixture): Promise<void> {
    await fs.mkdir(this.fixturesDir, { recursive: true });
    await fs.writeFile(
      this.fixturePath(fixture.workflowId),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    );
  }
}
