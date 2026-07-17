/**
 * Live client: a thin WebSocket wrapper around the authoritative server. It
 * assembles the same GameView the local sandbox produces, so the views don't
 * care which mode is active. The server is the source of truth — this only
 * receives snapshots and sends validated commands.
 */
import type { GalaxyDto, GameEvent, GameView, EmpireInfo, MineView, Ownership, Society } from './model';
import type { Snapshot } from '@pure-galaxy/world-core';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type ServerMessage =
  | { type: 'welcome'; empireId: string | null; tick: number; season: number; public: Snapshot; mine: MineView | null; galaxy: GalaxyDto; empires: EmpireInfo[]; ownership: Ownership; society: Society }
  | { type: 'snapshot'; tick: number; public: Snapshot; mine: MineView | null; ownership: Ownership; society: Society }
  | { type: 'lobby'; galaxy: GalaxyDto; empires: EmpireInfo[] }
  | { type: 'ack'; name: string; ok: boolean; message: string }
  | { type: 'event'; time: number; kind: string; text: string }
  | { type: 'pong' }
  | { type: 'error'; message: string };

export interface Ack {
  name: string;
  ok: boolean;
  message: string;
  at: number;
}

export class LiveClient {
  status: ConnStatus = 'disconnected';
  empireId: string | null = null;
  view: GameView | null = null;
  acks: Ack[] = [];
  lastError = '';

  private ws: WebSocket | null = null;
  private galaxy: GalaxyDto | null = null;
  private empires: EmpireInfo[] = [];
  private events: GameEvent[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  connect(url: string): void {
    this.disconnect();
    this.status = 'connecting';
    this.lastError = '';
    this.notify();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.status = 'error';
      this.lastError = (e as Error).message;
      this.notify();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'connected';
      ws.send(JSON.stringify({ type: 'join' }));
      this.notify();
    };
    ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string) as ServerMessage);
    ws.onclose = () => {
      if (this.status !== 'error') this.status = 'disconnected';
      this.notify();
    };
    ws.onerror = () => {
      this.status = 'error';
      this.lastError = 'connection failed';
      this.notify();
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.status = 'disconnected';
    this.empireId = null;
    this.view = null;
    this.galaxy = null;
    this.events = [];
  }

  sendCommand(name: string, args: Record<string, unknown> = {}): void {
    if (this.ws && this.status === 'connected') this.ws.send(JSON.stringify({ type: 'command', name, args }));
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.empireId = msg.empireId;
        this.galaxy = msg.galaxy;
        this.empires = msg.empires;
        this.rebuild(msg.public, msg.mine, msg.ownership, msg.society);
        break;
      case 'snapshot':
        this.rebuild(msg.public, msg.mine, msg.ownership, msg.society);
        break;
      case 'lobby':
        this.galaxy = msg.galaxy;
        this.empires = msg.empires;
        break;
      case 'event':
        this.events = [...this.events, { time: msg.time, kind: msg.kind, text: msg.text }].slice(-20);
        if (this.view) this.view = { ...this.view, events: this.events };
        break;
      case 'ack':
        this.acks = [...this.acks, { name: msg.name, ok: msg.ok, message: msg.message, at: Date.now() }].slice(-8);
        break;
      case 'error':
        this.lastError = msg.message;
        break;
      default:
        break;
    }
    this.notify();
  }

  private rebuild(snapshot: Snapshot, mine: MineView | null, ownership: Ownership, society: Society): void {
    if (!this.galaxy) return;
    this.view = { empires: this.empires, galaxy: this.galaxy, ownership, snapshot, mine, society, events: this.events };
  }
}
