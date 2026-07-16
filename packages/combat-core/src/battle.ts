/**
 * WEGO tactical battle engine v1 (design prompt §10).
 *
 * A round has a planning phase (each ship gets an order from its doctrine, §10.8)
 * and a resolution phase split into 10 impulses in which movement and fire are
 * interleaved in initiative order (§10.3) — so faster ships genuinely reposition
 * before slow guns bear. Damage flows shields -> armour -> structure with
 * subsystem crits (§10.4), and weapon/armour type match-ups create the
 * rock-paper-scissors layer (§10.6). Everything is driven by a single seeded
 * Rng, so a battle is a pure function of (sides, seed) and fully replayable.
 */
import { Rng } from './rng.js';
import {
  hexDistance,
  hexDirectionTo,
  hexNeighbor,
  relativeDirection,
  type Hex,
} from './hex.js';
import { Catalog } from './catalog.js';
import { computeShipStats } from './blueprint.js';
import { BattleLog } from './log.js';
import {
  evaluateDoctrine,
  DEFAULT_ORDER,
  PRESET_DOCTRINES,
  type Doctrine,
  type ResolvedOrder,
} from './doctrine.js';
import type { BattleConfig, HullClass, Sector, Side, ShipStats } from './types.js';

/** Impulse (0..9) at which each weapon type delivers its effect. */
const FIRE_IMPULSE: Record<string, number> = { beam: 2, kinetic: 5, missile: 8 };

/** Relative-direction (0..5) -> shield/armour sector (0 front,1 right,2 rear,3 left). */
const SECTOR_OF_REL: Sector[] = [0, 1, 1, 2, 3, 3];

/** Weapon type damage multiplier vs shields (%), the "beam beats shields" axis. */
const SHIELD_MULT: Record<string, number> = { kinetic: 55, beam: 150, missile: 100 };

/** Weapon type vs armour type damage multiplier (%), the armour match-up axis. */
const ARMOR_MULT: Record<string, Record<string, number>> = {
  kinetic: { plated: 100, ablative: 135, composite: 90 },
  beam: { plated: 100, ablative: 90, composite: 70 },
  missile: { plated: 115, ablative: 100, composite: 100 },
};

const IMPULSES = 10;

interface RoundMod {
  speed: number;
  evasion: number;
  weaponDmgMult: number;
  shieldRegenMult: number;
  initiative: number;
}

interface Crits {
  engines: number;
  weapons: number;
  reactor: number;
  bridge: number;
  shields: number;
}

interface ShipState {
  id: string;
  side: 0 | 1;
  stats: ShipStats;
  isFlagship: boolean;
  doctrine: Doctrine;
  pos: Hex;
  facing: number;
  structure: number;
  shields: number[];
  armorHp: number[];
  heat: number;
  morale: number;
  crits: Crits;
  destroyed: boolean;
  withdrawn: boolean;
  escaped: boolean;
  below50: boolean;
  below25: boolean;
  order: ResolvedOrder;
  primaryTargetId: string | null;
  mod: RoundMod;
  /** Remaining salvos per weapon index (Infinity for energy weapons). */
  ammo: number[];
}

export interface BattleShipSummary {
  id: string;
  side: string;
  hullClass: HullClass;
  alive: boolean;
  withdrawn: boolean;
  structurePct: number;
}

export interface BattleResult {
  seed: number;
  winner: string | null;
  reason: 'annihilation' | 'timeout' | 'draw';
  rounds: number;
  log: BattleLog;
  logHash: string;
  survivors: [number, number];
  ships: BattleShipSummary[];
}

export interface RunBattleOptions {
  /** Doctrine lookup by id; falls back to the preset library then 'balanced'. */
  doctrines?: Record<string, Doctrine>;
}

export function runBattle(
  sides: [Side, Side],
  catalog: Catalog,
  config: BattleConfig,
  options: RunBattleOptions = {},
): BattleResult {
  const rng = new Rng(config.seed);
  const maxRounds = config.maxRounds ?? 20;
  const mapWidth = config.mapWidth ?? 40;
  const log = new BattleLog();

  const doctrineLib = { ...PRESET_DOCTRINES, ...(options.doctrines ?? {}) };
  const resolveDoctrine = (id: string | undefined): Doctrine =>
    (id && doctrineLib[id]) || PRESET_DOCTRINES.balanced;

  const ships: ShipState[] = [];
  const startColumn = Math.min(14, Math.floor(mapWidth / 2) - 2);

  for (let s = 0; s < 2; s++) {
    const side = sides[s];
    const n = side.ships.length;
    for (let k = 0; k < n; k++) {
      const fs = side.ships[k];
      const stats = computeShipStats(fs.blueprint, catalog);
      const q = s === 0 ? -startColumn : startColumn;
      const r = k - Math.floor((n - 1) / 2);
      ships.push({
        id: fs.id,
        side: s as 0 | 1,
        stats,
        isFlagship: fs.isFlagship ?? false,
        doctrine: resolveDoctrine(fs.doctrineId),
        pos: { q, r },
        facing: s === 0 ? 0 : 3,
        structure: stats.maxStructure,
        shields: stats.shieldCapacity.slice(),
        armorHp: stats.armor.map((a) => a.hp),
        heat: 0,
        morale: 100,
        crits: { engines: 0, weapons: 0, reactor: 0, bridge: 0, shields: 0 },
        destroyed: false,
        withdrawn: false,
        escaped: false,
        below50: false,
        below25: false,
        order: { ...DEFAULT_ORDER, energy: { ...DEFAULT_ORDER.energy } },
        primaryTargetId: null,
        mod: { speed: stats.speed, evasion: stats.evasion, weaponDmgMult: 100, shieldRegenMult: 100, initiative: 0 },
        ammo: stats.weapons.map((w) => w.ammo),
      });
    }
  }

  const byId = new Map<string, ShipState>();
  for (const sh of ships) byId.set(sh.id, sh);

  log.push({
    t: 'battle_start',
    seed: config.seed,
    sides: [sides[0].id, sides[1].id],
    ships: ships.length,
  });

  const effectiveCount = (side: 0 | 1): number =>
    ships.filter((s) => s.side === side && !s.destroyed && !s.withdrawn && !s.escaped).length;

  let round = 0;
  let endReason: BattleResult['reason'] = 'draw';

  for (round = 1; round <= maxRounds; round++) {
    if (effectiveCount(0) === 0 || effectiveCount(1) === 0) break;
    log.push({ t: 'round_start', round });

    // ---- Planning phase: each ship resolves its doctrine into an order. ----
    for (const sh of ships) {
      if (sh.destroyed || sh.escaped) continue;
      planShip(sh, ships, byId);
      log.push({ t: 'order', round, ship: sh.id, target: sh.primaryTargetId, stance: sh.order.stance });
    }

    // ---- Resolution phase: 10 impulses of interleaved move + fire. ----
    for (let i = 0; i < IMPULSES; i++) {
      const order = activeInInitiativeOrder(ships);

      // Movement sub-phase.
      for (const sh of order) {
        if (sh.destroyed || sh.escaped) continue;
        const moves = movesThisImpulse(sh.mod.speed, i);
        let moved = false;
        for (let m = 0; m < moves; m++) {
          if (stepShip(sh, byId, mapWidth)) moved = true;
        }
        if (!moved) faceTarget(sh, byId);
        if (moved) {
          log.push({ t: 'move', round, impulse: i, ship: sh.id, to: { ...sh.pos }, facing: sh.facing });
          maybeEscape(sh, mapWidth, startColumn, log, round, i);
        }
      }

      // Firing sub-phase.
      for (const sh of order) {
        if (sh.destroyed || sh.escaped || sh.withdrawn) continue;
        for (let wi = 0; wi < sh.stats.weapons.length; wi++) {
          const w = sh.stats.weapons[wi];
          if (FIRE_IMPULSE[w.weaponType] !== i) continue;
          if (sh.ammo[wi] <= 0) continue;
          const fired = fireWeapon(sh, w, byId, ships, rng, log, round, i);
          if (fired) sh.ammo[wi] -= 1;
        }
      }

      // Shield regen sub-phase.
      for (const sh of ships) {
        if (sh.destroyed || sh.escaped) continue;
        for (let sec = 0; sec < 4; sec++) {
          const cap = sh.stats.shieldCapacity[sec];
          if (sh.shields[sec] < cap) {
            const regen = Math.floor((sh.stats.shieldRegen[sec] * sh.mod.shieldRegenMult) / 100);
            sh.shields[sec] = Math.min(cap, sh.shields[sec] + regen);
          }
        }
        if (sh.heat > 0) sh.heat = Math.max(0, sh.heat - sh.stats.heatDissipation);
      }
    }

    // ---- End of round: morale checks. ----
    for (const sh of ships) {
      if (sh.destroyed || sh.escaped || sh.withdrawn) continue;
      if (sh.morale < 35) {
        const breakChance = (35 - sh.morale) * 2;
        if (rng.percent(breakChance)) {
          sh.withdrawn = true;
          sh.order.stance = 'retreat';
          log.push({ t: 'morale_break', round, ship: sh.id });
        }
      }
    }

    log.push({ t: 'round_end', round, aliveA: effectiveCount(0), aliveB: effectiveCount(1) });
  }

  const roundsPlayed = Math.max(0, round - 1);

  // Decide the winner.
  const eff0 = effectiveCount(0);
  const eff1 = effectiveCount(1);
  let winner: string | null = null;
  if (eff0 > 0 && eff1 === 0) {
    winner = sides[0].id;
    endReason = 'annihilation';
  } else if (eff1 > 0 && eff0 === 0) {
    winner = sides[1].id;
    endReason = 'annihilation';
  } else if (eff0 === 0 && eff1 === 0) {
    winner = null;
    endReason = 'draw';
  } else {
    // Timeout: compare surviving structure.
    const struct = (side: 0 | 1) =>
      ships.filter((s) => s.side === side && !s.destroyed && !s.escaped).reduce((a, s) => a + s.structure, 0);
    const st0 = struct(0);
    const st1 = struct(1);
    endReason = 'timeout';
    winner = st0 === st1 ? null : st0 > st1 ? sides[0].id : sides[1].id;
  }

  log.push({ t: 'battle_end', round: roundsPlayed, winner, reason: endReason });

  const summaries: BattleShipSummary[] = ships.map((s) => ({
    id: s.id,
    side: sides[s.side].id,
    hullClass: s.stats.hullClass,
    alive: !s.destroyed,
    withdrawn: s.withdrawn || s.escaped,
    structurePct: Math.round((s.structure * 100) / s.stats.maxStructure),
  }));

  return {
    seed: config.seed,
    winner,
    reason: endReason,
    rounds: roundsPlayed,
    log,
    logHash: log.hash(),
    survivors: [eff0, eff1],
    ships: summaries,
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function planShip(sh: ShipState, all: ShipState[], byId: Map<string, ShipState>): void {
  const enemies = all.filter((e) => e.side !== sh.side && !e.destroyed && !e.escaped);
  // Recompute round modifiers from energy order + crits (needs order first).
  const ctx = buildContext(sh, all, enemies);
  sh.order = sh.withdrawn
    ? { ...DEFAULT_ORDER, stance: 'retreat', energy: { shields: 160, weapons: 40, engines: 100 } }
    : evaluateDoctrine(sh.doctrine, ctx);
  sh.mod = computeRoundMod(sh);
  sh.primaryTargetId = enemies.length ? pickTarget(sh, enemies) : null;
  void byId;
}

function buildContext(sh: ShipState, all: ShipState[], enemies: ShipState[]) {
  const nearest = enemies.reduce(
    (best, e) => Math.min(best, hexDistance(sh.pos, e.pos)),
    Number.POSITIVE_INFINITY,
  );
  const shieldSum = sh.shields.reduce((a, b) => a + b, 0);
  const shieldCap = sh.stats.shieldCapacity.reduce((a, b) => a + b, 0) || 1;
  const enemyClasses = new Set<HullClass>();
  for (const e of enemies) enemyClasses.add(e.stats.hullClass);
  const friendlyCount = all.filter((f) => f.side === sh.side && !f.destroyed && !f.escaped).length;
  return {
    selfStructurePct: Math.round((sh.structure * 100) / sh.stats.maxStructure),
    selfShieldPct: Math.round((shieldSum * 100) / shieldCap),
    nearestEnemyDist: Number.isFinite(nearest) ? nearest : 999,
    enemyClasses,
    friendlyCount,
    enemyCount: enemies.length,
  };
}

function pickTarget(sh: ShipState, enemies: ShipState[]): string {
  const pref = sh.order.target;
  const score = (e: ShipState): number => {
    switch (pref) {
      case 'nearest':
        return hexDistance(sh.pos, e.pos);
      case 'weakest':
        return e.structure + e.shields.reduce((a, b) => a + b, 0);
      case 'strongest':
        return -(e.structure + e.shields.reduce((a, b) => a + b, 0));
      case 'biggest':
        return -e.stats.maxStructure;
      default:
        return hexDistance(sh.pos, e.pos);
    }
  };
  let best = enemies[0];
  let bestScore = score(best);
  for (const e of enemies) {
    const s = score(e);
    if (s < bestScore || (s === bestScore && e.id < best.id)) {
      best = e;
      bestScore = s;
    }
  }
  return best.id;
}

function computeRoundMod(sh: ShipState): RoundMod {
  const c = sh.crits;
  const reactorPenalty = c.reactor * 15;
  const enginePct = Math.max(10, sh.order.energy.engines - reactorPenalty);
  const speed = Math.max(1, Math.floor((sh.stats.speed * enginePct) / 100) - c.engines);
  const evasion = speed * 4;

  let weaponPct = Math.max(20, sh.order.energy.weapons - reactorPenalty);
  weaponPct = Math.max(20, Math.floor((weaponPct * (100 - 20 * c.weapons)) / 100));

  const shieldPct = Math.max(0, sh.order.energy.shields - reactorPenalty);
  const shieldRegenMult = Math.max(0, Math.floor((shieldPct * (100 - 25 * c.shields)) / 100));

  const initiative = speed * 10 + sh.stats.sensors - c.bridge * 20;
  return { speed, evasion, weaponDmgMult: weaponPct, shieldRegenMult, initiative };
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function activeInInitiativeOrder(ships: ShipState[]): ShipState[] {
  return ships
    .filter((s) => !s.destroyed && !s.escaped)
    .sort((a, b) => (b.mod.initiative - a.mod.initiative) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function movesThisImpulse(speed: number, impulse: number): number {
  const before = Math.floor((impulse * speed) / IMPULSES);
  const after = Math.floor(((impulse + 1) * speed) / IMPULSES);
  return after - before;
}

/** Desired engagement range for a ship, from its stance and weapon suite. */
function desiredRange(sh: ShipState): number {
  const opts = sh.stats.weapons.map((w) => w.optimalRange);
  if (opts.length === 0) return 3;
  switch (sh.order.stance) {
    case 'kite':
      return Math.max(...opts);
    case 'close':
      return Math.max(1, Math.min(...opts));
    default:
      return Math.min(...opts);
  }
}

function stepShip(sh: ShipState, byId: Map<string, ShipState>, mapWidth: number): boolean {
  if (sh.withdrawn || sh.order.stance === 'retreat') {
    return retreatStep(sh, mapWidth);
  }
  const target = sh.primaryTargetId ? byId.get(sh.primaryTargetId) : undefined;
  if (!target || target.destroyed || target.escaped) return false;

  const dist = hexDistance(sh.pos, target.pos);
  const want = desiredRange(sh);
  if (sh.order.stance === 'hold') return false;
  if (dist > want) return moveToward(sh, target.pos);
  if (sh.order.stance === 'kite' && dist < want) return moveAway(sh, target.pos);
  return false;
}

function moveToward(sh: ShipState, dest: Hex): boolean {
  let best = -1;
  let bestDist = hexDistance(sh.pos, dest);
  for (let d = 0; d < 6; d++) {
    const n = hexNeighbor(sh.pos, d);
    const nd = hexDistance(n, dest);
    if (nd < bestDist) {
      bestDist = nd;
      best = d;
    }
  }
  if (best < 0) return false;
  sh.pos = hexNeighbor(sh.pos, best);
  sh.facing = best;
  return true;
}

function moveAway(sh: ShipState, from: Hex): boolean {
  let best = -1;
  let bestDist = hexDistance(sh.pos, from);
  for (let d = 0; d < 6; d++) {
    const n = hexNeighbor(sh.pos, d);
    const nd = hexDistance(n, from);
    if (nd > bestDist) {
      bestDist = nd;
      best = d;
    }
  }
  if (best < 0) return false;
  sh.pos = hexNeighbor(sh.pos, best);
  sh.facing = best;
  return true;
}

function retreatStep(sh: ShipState, mapWidth: number): boolean {
  // Side 0 flees toward -q, side 1 toward +q.
  const dir = sh.side === 0 ? 3 : 0;
  sh.pos = hexNeighbor(sh.pos, dir);
  sh.facing = dir;
  void mapWidth;
  return true;
}

function faceTarget(sh: ShipState, byId: Map<string, ShipState>): void {
  const target = sh.primaryTargetId ? byId.get(sh.primaryTargetId) : undefined;
  if (!target || target.destroyed || target.escaped) return;
  sh.facing = hexDirectionTo(sh.pos, target.pos);
}

function maybeEscape(
  sh: ShipState,
  mapWidth: number,
  startColumn: number,
  log: BattleLog,
  round: number,
  impulse: number,
): void {
  const edge = startColumn + 6;
  if ((sh.side === 0 && sh.pos.q <= -edge) || (sh.side === 1 && sh.pos.q >= edge)) {
    if (sh.withdrawn && !sh.escaped) {
      sh.escaped = true;
      void log;
      void round;
      void impulse;
      void mapWidth;
    }
  }
}

// ---------------------------------------------------------------------------
// Firing & damage
// ---------------------------------------------------------------------------

function chooseFireTarget(
  sh: ShipState,
  weapon: ShipState['stats']['weapons'][number],
  all: ShipState[],
  byId: Map<string, ShipState>,
): ShipState | null {
  const detection = sh.stats.sensors;
  const eligible = (e: ShipState): boolean => {
    if (e.side === sh.side || e.destroyed || e.escaped) return false;
    const dist = hexDistance(sh.pos, e.pos);
    if (dist > weapon.maxRange || dist > detection) return false;
    const absDir = hexDirectionTo(sh.pos, e.pos);
    const rel = relativeDirection(sh.facing, absDir);
    return weapon.arc.includes(rel);
  };
  const primary = sh.primaryTargetId ? byId.get(sh.primaryTargetId) : undefined;
  if (primary && eligible(primary)) return primary;

  let best: ShipState | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const e of all) {
    if (!eligible(e)) continue;
    const d = hexDistance(sh.pos, e.pos);
    if (d < bestDist || (d === bestDist && best !== null && e.id < best.id)) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function fireWeapon(
  sh: ShipState,
  weapon: ShipState['stats']['weapons'][number],
  byId: Map<string, ShipState>,
  all: ShipState[],
  rng: Rng,
  log: BattleLog,
  round: number,
  impulse: number,
): boolean {
  // Overheat: a weapon whose heat would exceed capacity is skipped this round.
  if (sh.heat + weapon.heat > sh.stats.heatCapacity) return false;

  const target = chooseFireTarget(sh, weapon, all, byId);
  if (!target) return false;
  sh.heat += weapon.heat;
  const dist = hexDistance(sh.pos, target.pos);

  if (weapon.weaponType === 'missile') {
    // Point-defense interception at impact. PD is an AREA screen: the target's
    // own PD plus that of nearby friendlies form the interception pool, so an
    // escort's "завеса" actually protects the ships it is covering (§9, §10.6).
    const interceptChance = interceptionChance(target, all);
    let stopped = 0;
    let leaked = 0;
    for (let s = 0; s < weapon.shots; s++) {
      if (interceptChance > 0 && rng.percent(interceptChance)) stopped++;
      else leaked++;
    }
    if (interceptChance > 0) {
      log.push({ t: 'intercept', round, impulse, ship: sh.id, target: target.id, stopped, leaked });
    }
    for (let s = 0; s < leaked; s++) {
      resolveShot(sh, weapon, target, dist, rng, log, round, impulse, all);
      if (target.destroyed) break;
    }
    return true;
  }

  for (let s = 0; s < weapon.shots; s++) {
    resolveShot(sh, weapon, target, dist, rng, log, round, impulse, all);
    if (target.destroyed) break;
  }
  return true;
}

/** Missile interception radius for the point-defense screen (hexes). */
const PD_SCREEN_RADIUS = 3;

/** Combined interception chance vs one missile: own PD + half of nearby allies'. */
function interceptionChance(target: ShipState, all: ShipState[]): number {
  let pool = target.stats.pdRating;
  for (const f of all) {
    if (f.side !== target.side || f.destroyed || f.escaped || f.id === target.id) continue;
    if (f.stats.pdRating <= 0) continue;
    if (hexDistance(f.pos, target.pos) <= PD_SCREEN_RADIUS) {
      pool += Math.floor(f.stats.pdRating / 2);
    }
  }
  return Math.min(90, pool);
}

function resolveShot(
  sh: ShipState,
  weapon: ShipState['stats']['weapons'][number],
  target: ShipState,
  dist: number,
  rng: Rng,
  log: BattleLog,
  round: number,
  impulse: number,
  all: ShipState[],
): void {
  // To-hit.
  let acc = weapon.accuracy;
  if (weapon.weaponType === 'kinetic' && dist > weapon.optimalRange) {
    acc -= (dist - weapon.optimalRange) * 7;
  }
  const evasion =
    weapon.weaponType === 'kinetic'
      ? target.mod.evasion
      : weapon.weaponType === 'beam'
        ? Math.floor(target.mod.evasion / 2)
        : Math.floor(target.mod.evasion / 4);
  acc = Math.max(5, Math.min(95, acc - evasion));

  if (!rng.percent(acc)) {
    log.push({
      t: 'fire', round, impulse, ship: sh.id, target: target.id, weapon: weapon.name,
      weaponType: weapon.weaponType, hit: false, sector: -1, shieldDmg: 0, armorDmg: 0, structDmg: 0,
    });
    return;
  }

  // Base damage with energy/crit mods and beam range falloff.
  let raw = Math.floor((weapon.damage * sh.mod.weaponDmgMult) / 100);
  if (weapon.weaponType === 'beam' && dist > weapon.optimalRange) {
    raw = Math.floor((raw * Math.max(40, 100 - (dist - weapon.optimalRange) * 10)) / 100);
  }
  raw = Math.max(1, raw);

  // Sector from geometry.
  const absDirToShooter = hexDirectionTo(target.pos, sh.pos);
  const rel = relativeDirection(target.facing, absDirToShooter);
  const sector = SECTOR_OF_REL[rel];

  const result = applyDamage(target, sector, raw, weapon.weaponType, rng, log, round, impulse);

  log.push({
    t: 'fire', round, impulse, ship: sh.id, target: target.id, weapon: weapon.name,
    weaponType: weapon.weaponType, hit: true, sector,
    shieldDmg: result.shieldDmg, armorDmg: result.armorDmg, structDmg: result.structDmg,
  });

  if (result.structDmg > 0 && !target.destroyed) {
    rollCrit(target, result.structDmg, rng, log, round, impulse);
  }

  if (target.structure <= 0 && !target.destroyed) {
    target.destroyed = true;
    target.structure = 0;
    log.push({ t: 'destroyed', round, impulse, ship: target.id, by: sh.id });
    applyDeathMorale(target, all);
  } else {
    applyDamageMorale(target);
  }
}

interface DamageResult {
  shieldDmg: number;
  armorDmg: number;
  structDmg: number;
}

function applyDamage(
  target: ShipState,
  sector: Sector,
  raw: number,
  weaponType: string,
  rng: Rng,
  log: BattleLog,
  round: number,
  impulse: number,
): DamageResult {
  let shieldDmg = 0;
  let remaining = raw;

  // Shield phase.
  const shieldMult = SHIELD_MULT[weaponType];
  const shield = target.shields[sector];
  if (shield > 0) {
    const effShieldDmg = Math.floor((raw * shieldMult) / 100);
    if (shield >= effShieldDmg) {
      target.shields[sector] = shield - effShieldDmg;
      shieldDmg = effShieldDmg;
      remaining = 0;
    } else {
      shieldDmg = shield;
      const baseStopped = Math.floor((shield * 100) / shieldMult);
      remaining = Math.max(0, raw - baseStopped);
      target.shields[sector] = 0;
      log.push({ t: 'shield_down', round, impulse, ship: target.id, sector });
    }
  }

  if (remaining <= 0) return { shieldDmg, armorDmg: 0, structDmg: 0 };

  // Armour phase.
  const armor = target.stats.armor[sector];
  const armorType = armor ? armor.type : 'plated';
  const armorMult = ARMOR_MULT[weaponType][armorType] ?? 100;
  let dmg = Math.floor((remaining * armorMult) / 100);
  dmg = Math.max(1, dmg);

  let armorDmg = 0;
  let pierced = dmg;
  if (target.armorHp[sector] > 0 && armor) {
    const reduced = Math.max(1, dmg - armor.absorb);
    const chip = Math.min(target.armorHp[sector], reduced);
    target.armorHp[sector] -= chip;
    armorDmg = chip;
    pierced = reduced - chip;
  }

  // Structure phase.
  if (pierced > 0) {
    target.structure -= pierced;
  }
  void rng;
  return { shieldDmg, armorDmg, structDmg: pierced };
}

function rollCrit(target: ShipState, structDmg: number, rng: Rng, log: BattleLog, round: number, impulse: number): void {
  const chance = Math.min(40, 5 + Math.floor((structDmg * 50) / target.stats.maxStructure));
  if (!rng.percent(chance)) return;
  const systems: (keyof Crits)[] = ['engines', 'weapons', 'reactor', 'bridge', 'shields'];
  const sys = systems[rng.int(systems.length)];
  target.crits[sys] += 1;
  log.push({ t: 'crit', round, impulse, ship: target.id, system: sys });
}

function applyDamageMorale(sh: ShipState): void {
  const pct = (sh.structure * 100) / sh.stats.maxStructure;
  if (!sh.below50 && pct < 50) {
    sh.below50 = true;
    sh.morale = Math.max(0, sh.morale - 15);
  }
  if (!sh.below25 && pct < 25) {
    sh.below25 = true;
    sh.morale = Math.max(0, sh.morale - 25);
  }
}

function applyDeathMorale(dead: ShipState, all: ShipState[]): void {
  // Losing the flagship shakes the whole side (§10.7 morale).
  if (!dead.isFlagship) return;
  for (const sh of all) {
    if (sh.side === dead.side && !sh.destroyed && sh.id !== dead.id) {
      sh.morale = Math.max(0, sh.morale - 25);
    }
  }
}
