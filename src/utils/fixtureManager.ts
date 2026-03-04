import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

export interface WorkflowFixture {
  version: '1.0';
  capturedAt: string;
  workflowId: string;
  workflowName: string;
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

  exists(workflowId: string): boolean {
    return existsSync(this.fixturePath(workflowId));
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
    const fixture = this.load(workflowId);
    return fixture ? new Date(fixture.capturedAt) : null;
  }

  async save(fixture: WorkflowFixture): Promise<void> {
    await fs.mkdir(this.fixturesDir, { recursive: true });
    await fs.writeFile(
      this.fixturePath(fixture.workflowId),
      JSON.stringify(fixture, null, 2),
      'utf-8'
    );
  }
}
