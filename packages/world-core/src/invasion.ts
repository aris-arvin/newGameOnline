/**
 * Ground invasions (design prompt §10.10). With orbital dominance (no enemy
 * fleet left in the system) an empire whose fleet carries troops can capture an
 * unprotected enemy colony. Homeworlds are invulnerable (§6.1). A captured
 * colony keeps its buildings and population but suffers high unrest (§10.10),
 * which the economy suppresses until it settles.
 */
import type { WorldData, WorldState } from './types.js';
import { areHostile } from './diplomacy.js';
import { isProtected } from './protection.js';

export function invasionStep(world: WorldState, data: WorldData): void {
  for (const eid of Object.keys(world.empires).sort()) {
    const empire = world.empires[eid];
    if (empire.pirate || empire.ancient) continue;
    for (const fid of [...empire.fleetIds].sort()) {
      const fleet = world.fleets[fid];
      if (!fleet || !fleet.ships.some((s) => s.role === 'troops')) continue;
      const sys = fleet.systemId;

      for (const cid of Object.keys(world.colonies).sort()) {
        const colony = world.colonies[cid];
        if (colony.empireId === eid || colony.homeworld) continue;
        if (world.galaxy.planets[colony.planetId].systemId !== sys) continue;
        const owner = world.empires[colony.empireId];
        if (!owner || isProtected(world, owner, data) || !areHostile(world, eid, colony.empireId)) continue;

        // Orbital dominance: the defender has no fleet left in the system.
        const defended = Object.values(world.fleets).some((f) => f.empireId === colony.empireId && f.systemId === sys);
        if (defended) continue;

        // Capture.
        owner.colonyIds = owner.colonyIds.filter((x) => x !== cid);
        colony.empireId = eid;
        empire.colonyIds.push(cid);
        colony.unrest = 60;
        colony.buildQueue = [];
        const idx = fleet.ships.findIndex((s) => s.role === 'troops');
        if (idx >= 0) fleet.ships.splice(idx, 1);
        world.log.push({
          time: world.time,
          kind: 'invasion',
          text: `${empire.name} conquered ${world.galaxy.planets[colony.planetId].name} from ${owner.name}`,
        });
        break; // one conquest per fleet per tick
      }
    }
  }
}
