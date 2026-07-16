/**
 * Blueprint compiler: turns a Blueprint (hull + installed components) into the
 * derived ShipStats used by the battle engine (design prompt §8). Deterministic
 * and server-authoritative — the same numbers back the client's "live preview".
 */
import type {
  Blueprint,
  ShipStats,
  MountedWeapon,
  Mount,
  ArmorType,
} from './types.js';
import { Catalog, ARC_BY_MOUNT } from './catalog.js';

/** Tunable derivation constants (would live in data for a shipped game). */
export const STAT_CONSTANTS = {
  speedScale: 12,
  minSpeed: 1,
  maxSpeed: 8,
  evasionPerSpeed: 4,
} as const;

const ALL_MOUNTS: Mount[] = ['nose', 'side', 'rear', 'internal'];

function splitAcross4(total: number): number[] {
  const each = Math.floor(total / 4);
  return [each, each, each, each];
}

export function computeShipStats(blueprint: Blueprint, catalog: Catalog): ShipStats {
  const hull = catalog.hull(blueprint.hullId);
  const issues: string[] = [];

  // Slot usage per mount.
  const used: Record<Mount, number> = { nose: 0, side: 0, rear: 0, internal: 0 };

  let mass = hull.mass;
  let power = 0;
  let thrust = 0;
  let shieldCapacity = 0;
  let shieldRegen = 0;
  let sensors = hull.baseSensors;
  let signature = hull.baseSignature;
  let pdRating = 0;
  let cloak = 0;

  const armorParts: { hp: number; type: ArmorType; absorb: number }[] = [];
  const weapons: MountedWeapon[] = [];

  for (const inst of blueprint.components) {
    if (!catalog.hasComponent(inst.defId)) {
      issues.push(`missing component ${inst.defId}`);
      continue;
    }
    const def = catalog.component(inst.defId);
    used[inst.mount] += 1;
    mass += def.mass;
    power += def.power;
    signature += Math.floor(def.mass / 4);

    switch (def.kind) {
      case 'reactor':
        break;
      case 'engine':
        thrust += def.thrust;
        break;
      case 'shield':
        shieldCapacity += def.capacity;
        shieldRegen += def.regen;
        break;
      case 'armor':
        armorParts.push({ hp: def.hp, type: def.armorType, absorb: def.absorb });
        break;
      case 'sensor':
        sensors += def.sensors;
        cloak += def.cloak;
        break;
      case 'pd':
        pdRating += def.intercept;
        break;
      case 'weapon': {
        if (!def.mounts.includes(inst.mount)) {
          issues.push(`${def.id} cannot mount in ${inst.mount}`);
        }
        weapons.push({
          defId: def.id,
          name: def.name,
          weaponType: def.weaponType,
          damage: def.damage,
          optimalRange: def.optimalRange,
          maxRange: def.maxRange,
          accuracy: def.accuracy,
          heat: def.heat,
          shots: def.shots,
          ammo: def.ammo ?? Number.POSITIVE_INFINITY,
          mount: inst.mount,
          arc: ARC_BY_MOUNT[inst.mount],
        });
        break;
      }
    }
  }

  // Slot validation.
  for (const m of ALL_MOUNTS) {
    if (used[m] > hull.slots[m]) {
      issues.push(`too many ${m} components: ${used[m]}/${hull.slots[m]}`);
    }
  }

  // Power balance.
  if (power < 0) {
    issues.push(`power deficit: ${power}`);
  }

  // Derived movement.
  const speed = Math.max(
    STAT_CONSTANTS.minSpeed,
    Math.min(STAT_CONSTANTS.maxSpeed, Math.floor((thrust * STAT_CONSTANTS.speedScale) / mass)),
  );
  const evasion = speed * STAT_CONSTANTS.evasionPerSpeed;

  // Armour aggregation: sum HP, pick dominant type, use its absorb.
  let armorHp = 0;
  let armorType: ArmorType = 'plated';
  let armorAbsorb = 0;
  if (armorParts.length > 0) {
    armorHp = armorParts.reduce((s, a) => s + a.hp, 0);
    const dominant = armorParts.reduce((best, a) => (a.hp > best.hp ? a : best), armorParts[0]);
    armorType = dominant.type;
    armorAbsorb = Math.max(...armorParts.map((a) => a.absorb));
  }
  const armorPerSector = splitAcross4(armorHp).map((hp) => ({ hp, type: armorType, absorb: armorAbsorb }));

  const effectiveSignature = Math.max(1, signature - cloak);

  const stats: ShipStats = {
    blueprintId: blueprint.id,
    name: blueprint.name,
    hullClass: hull.class,
    maxStructure: hull.structure,
    speed,
    evasion,
    sensors,
    signature: effectiveSignature,
    shieldCapacity: splitAcross4(shieldCapacity),
    shieldRegen: splitAcross4(shieldRegen),
    armor: armorPerSector,
    weapons,
    pdRating,
    heatCapacity: hull.heatCapacity,
    heatDissipation: hull.heatDissipation,
    crew: hull.crew,
    powerBalance: power,
    valid: issues.length === 0,
    issues,
  };
  return stats;
}
