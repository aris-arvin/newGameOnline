/**
 * Core domain types for the combat engine (design prompt §8 ship builder, §10
 * combat). Balance numbers live in JSON data files (§21.3), not here — these
 * are the shapes those files must satisfy.
 */
import type { Hex } from './hex.js';

export type HullClass =
  | 'corvette'
  | 'frigate'
  | 'destroyer'
  | 'cruiser'
  | 'battlecruiser'
  | 'battleship'
  | 'carrier'
  | 'titan';

/** Physical mounting location on a hull; determines a weapon's firing arc. */
export type Mount = 'nose' | 'side' | 'rear' | 'internal';

export type WeaponType = 'kinetic' | 'beam' | 'missile';

/** Armour families with distinct resistances (§10.4, §10.6 rock-paper-scissors). */
export type ArmorType = 'plated' | 'ablative' | 'composite';

/** Shield/armour facing quadrants: 0 front, 1 right, 2 rear, 3 left (§10.4). */
export type Sector = 0 | 1 | 2 | 3;

export interface HullDef {
  id: string;
  name: string;
  class: HullClass;
  /** Base structural mass; combined with component mass to derive speed. */
  mass: number;
  /** Hull hit points before destruction. */
  structure: number;
  /** How many components of each mount type fit. */
  slots: Record<Mount, number>;
  crew: number;
  baseSensors: number;
  baseSignature: number;
  heatCapacity: number;
  /** Heat shed per impulse. */
  heatDissipation: number;
}

export interface ReactorDef {
  id: string;
  name: string;
  kind: 'reactor';
  mass: number;
  /** Positive: power produced. */
  power: number;
}

export interface EngineDef {
  id: string;
  name: string;
  kind: 'engine';
  mass: number;
  /** Negative: power drawn. */
  power: number;
  thrust: number;
}

export interface ShieldDef {
  id: string;
  name: string;
  kind: 'shield';
  mass: number;
  power: number;
  /** Total shield capacity, split evenly across the four sectors. */
  capacity: number;
  /** Total regen per impulse, split across sectors. */
  regen: number;
}

export interface ArmorDef {
  id: string;
  name: string;
  kind: 'armor';
  mass: number;
  power: number;
  armorType: ArmorType;
  /** Total armour HP, split across sectors. */
  hp: number;
  /** Flat damage absorbed per hit before armour HP is chipped. */
  absorb: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  kind: 'weapon';
  mass: number;
  power: number;
  weaponType: WeaponType;
  damage: number;
  /** Range at/under which there is no damage falloff. */
  optimalRange: number;
  /** Beyond this range the weapon cannot fire. */
  maxRange: number;
  /** Base to-hit before evasion/range modifiers (0..100). */
  accuracy: number;
  /** Heat generated per shot. */
  heat: number;
  /** Shots fired per round. */
  shots: number;
  /** Salvos available for the whole battle (ammo). Omit for unlimited (energy weapons). */
  ammo?: number;
  /** Mounts this weapon can be installed in. */
  mounts: Mount[];
}

export interface PointDefenseDef {
  id: string;
  name: string;
  kind: 'pd';
  mass: number;
  power: number;
  /** Interception strength vs incoming missiles (0..100 per missile). */
  intercept: number;
}

export interface SensorDef {
  id: string;
  name: string;
  kind: 'sensor';
  mass: number;
  power: number;
  sensors: number;
  /** Reduces this ship's detectability. */
  cloak: number;
}

export type ComponentDef =
  | ReactorDef
  | EngineDef
  | ShieldDef
  | ArmorDef
  | WeaponDef
  | PointDefenseDef
  | SensorDef;

export interface InstalledComponent {
  defId: string;
  mount: Mount;
}

export interface Blueprint {
  id: string;
  name: string;
  hullId: string;
  /** Owning race (for flavour / future racial component bonuses, §4). */
  race?: string;
  components: InstalledComponent[];
}

/** A weapon as mounted on a specific ship (arc resolved from its mount). */
export interface MountedWeapon {
  defId: string;
  name: string;
  weaponType: WeaponType;
  damage: number;
  optimalRange: number;
  maxRange: number;
  accuracy: number;
  heat: number;
  shots: number;
  /** Salvos available for the whole battle; Infinity for energy weapons. */
  ammo: number;
  mount: Mount;
  /** Relative directions (0..5, relative to ship facing) this weapon can fire into. */
  arc: number[];
}

/** Fully derived combat statistics for one blueprint (deterministic, server-authoritative). */
export interface ShipStats {
  blueprintId: string;
  name: string;
  hullClass: HullClass;
  maxStructure: number;
  /** Hexes per round on balanced power. */
  speed: number;
  /** To-hit reduction applied to attackers using tracking weapons. */
  evasion: number;
  sensors: number;
  signature: number;
  /** Per-sector shield capacity [front, right, rear, left]. */
  shieldCapacity: number[];
  /** Per-sector shield regen per impulse. */
  shieldRegen: number[];
  /** Per-sector armour. */
  armor: { hp: number; type: ArmorType; absorb: number }[];
  weapons: MountedWeapon[];
  pdRating: number;
  heatCapacity: number;
  heatDissipation: number;
  crew: number;
  /** Net power balance (>= 0 means the reactor covers demand). */
  powerBalance: number;
  valid: boolean;
  issues: string[];
}

export interface FleetShip {
  /** Unique within the battle. */
  id: string;
  blueprint: Blueprint;
  isFlagship?: boolean;
  doctrineId?: string;
}

export interface Side {
  id: string;
  name: string;
  ships: FleetShip[];
}

export interface BattleConfig {
  seed: number;
  mapWidth?: number;
  mapHeight?: number;
  maxRounds?: number;
}

export interface Position {
  pos: Hex;
  facing: number;
}
