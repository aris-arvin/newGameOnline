/**
 * Pluggable persistence (design prompt §18.2). The WorldState is plain,
 * JSON-serialisable data, so it round-trips cleanly. The slice ships an
 * in-memory and a file adapter; a production PostgreSQL/Redis adapter would
 * implement the same interface.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorldState } from '@pure-galaxy/world-core';

export interface Persistence {
  load(): WorldState | null;
  save(world: WorldState): void;
}

export class MemoryPersistence implements Persistence {
  private data: string | null = null;
  load(): WorldState | null {
    return this.data ? (JSON.parse(this.data) as WorldState) : null;
  }
  save(world: WorldState): void {
    this.data = JSON.stringify(world);
  }
}

export class FilePersistence implements Persistence {
  constructor(private readonly file: string) {}
  load(): WorldState | null {
    if (!existsSync(this.file)) return null;
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as WorldState;
    } catch {
      return null;
    }
  }
  save(world: WorldState): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(world));
  }
}
