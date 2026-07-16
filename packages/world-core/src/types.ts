/**
 * Domain + config types for the PURE GALAXY world simulation (Phase 0, §20).
 * Balance numbers live in `data/world-data.json` (§21.3); these are the shapes.
 */

// --- Galaxy ---------------------------------------------------------------

export type Biome = 'terra' | 'ocean' | 'tundra' | 'desert' | 'toxic' | 'lava' | 'barren';
export type Gravity = 'low' | 'normal' | 'high';

export interface Planet {
  id: string;
  systemId: string;
  name: string;
  /** 1..10; drives the number of region slots. */
  size: number;
  biome: Biome;
  gravity: Gravity;
  /** Mineral richness 1..5. */
  richness: number;
  /** Asteroid-belt richness 0..5 (0 = no belt), source of exotic resources. */
  belt: number;
  ruins: boolean;
  regionSlots: number;
}

export interface StarSystem {
  id: string;
  name: string;
  sectorId: string;
  x: number;
  y: number;
  planetIds: string[];
}

export interface Sector {
  id: string;
  name: string;
  systemIds: string[];
}

export interface Lane {
  to: string;
  dist: number;
}

export interface Galaxy {
  sectors: Sector[];
  systems: Record<string, StarSystem>;
  planets: Record<string, Planet>;
  /** Hyperlane adjacency: systemId -> outgoing lanes. */
  lanes: Record<string, Lane[]>;
}

// --- Economy --------------------------------------------------------------

export type ResourceGroup = 'metals' | 'minerals' | 'gas' | 'organics' | 'exotic';
export type MaterialKind = 'alloys' | 'fuel' | 'electronics' | 'food' | 'composites';
export type School = 'physics' | 'economics';

export const RESOURCE_GROUPS: ResourceGroup[] = ['metals', 'minerals', 'gas', 'organics', 'exotic'];
export const MATERIAL_KINDS: MaterialKind[] = ['alloys', 'fuel', 'electronics', 'food', 'composites'];
export const SCHOOLS: School[] = ['physics', 'economics'];

export type Stock = Record<ResourceGroup | MaterialKind, number>;

export type RegionSpec =
  | 'empty'
  | 'mining'
  | 'extractor'
  | 'farm'
  | 'industry'
  | 'science'
  | 'housing'
  | 'spaceport'
  | 'military';

export interface Region {
  spec: RegionSpec;
  /** Development level; 0 = undeveloped. */
  level: number;
}

export type BuildKind = 'develop' | 'respec' | 'add_region';

export interface BuildOrder {
  kind: BuildKind;
  regionIndex?: number;
  newSpec?: RegionSpec;
  cost: number;
  progress: number;
  label: string;
}

export interface Colony {
  id: string;
  planetId: string;
  empireId: string;
  homeworld: boolean;
  population: number;
  regions: Region[];
  stock: Stock;
  buildQueue: BuildOrder[];
  /** Governor plan id, or '' for manual control. */
  governor: string;
  /** Accumulated ruin-excavation progress (§13); undefined = none. */
  excavation?: number;
  /** Loyalty/unrest after conquest, 0..100 (§10.10); undefined = fully loyal. */
  unrest?: number;
}

// --- Empires & fleets -----------------------------------------------------

export interface Empire {
  id: string;
  name: string;
  raceId: string;
  credits: number;
  focus: number;
  research: Record<School, number>;
  /** Relative weights for splitting research potential across schools. */
  researchSliders: Record<School, number>;
  unlockedTechs: string[];
  colonyIds: string[];
  fleetIds: string[];
  isNpc: boolean;
  /** Empire-level tradable goods pool fed by colonies (§16 logistics). */
  treasury: Stock;
  /** Tick this empire was founded, for newbie protection (§14.1). */
  foundedTick: number;
  /** Relations toward other empires, -100..100 (§11). */
  relations: Record<string, number>;
  /** Counter-intelligence strength vs enemy agents (§12). */
  counterIntel: number;
  /** True for the roaming pirate faction (§14.4). */
  pirate: boolean;
  // --- Phase 3 (politics & PvE) ---
  /** True for the Ancients NPC faction (§13). */
  ancient: boolean;
  /** Artifacts recovered from ruins (§13). */
  artifacts: number;
  /** Gate expeditions completed, 0..5 (§13, §15 science victory). */
  expeditionsDone: number;
  /** Cumulative market turnover, for the economic victory share (§15). */
  tradeVolume: number;
  /** Tick until which the empire is embargoed from the NPC market (§11.3). */
  sanctionedUntil: number;
  admiralIds: string[];
  /** In-progress Gate expedition, if any (§13). */
  expeditionRun?: { stage: number; progress: number };
  // --- Phase 4 (seasons & legacy, §15) ---
  /** Permanent account progress carried across seasons (§15). */
  legacy: number;
  titles: string[];
  /** Capped ±5% head-start bonus derived from legacy. */
  legacyBonusPct: number;
}

export type ShipRole = 'warship' | 'colony' | 'miner' | 'troops';

export interface Ship {
  role: ShipRole;
  power: number;
}

export interface FleetOrder {
  type: 'move' | 'colonize' | 'convoy';
  /** Remaining systems to traverse (in order); path[last] is the destination. */
  path: string[];
  /** Progress along the lane toward path[0]. */
  legProgress: number;
  targetPlanetId?: string;
}

export interface Fleet {
  id: string;
  empireId: string;
  systemId: string;
  ships: Ship[];
  order?: FleetOrder;
  /** Cargo carried by a convoy (§5.4); undefined for a normal fleet. */
  cargo?: Stock;
}

// --- World ----------------------------------------------------------------

export interface WorldEvent {
  time: number;
  kind: string;
  text: string;
}

export interface WorldState {
  seed: number;
  time: number;
  galaxy: Galaxy;
  empires: Record<string, Empire>;
  colonies: Record<string, Colony>;
  fleets: Record<string, Fleet>;
  nextId: number;
  log: WorldEvent[];
  // --- Society layer (Phase 2, §11-§16) ---
  treaties: Treaty[];
  market: MarketState;
  agents: Record<string, Agent>;
  // --- Politics & PvE (Phase 3, §11.3, §13, §15) ---
  senate: SenateState;
  admirals: Record<string, Admiral>;
  galacticFund: number;
  victor: Victor | null;
  /** Consecutive-tick counters toward the sustained victory conditions (§15). */
  holds: { military: Record<string, number>; economic: Record<string, number> };
  season: SeasonState;
}

// --- Seasons (§15) --------------------------------------------------------

export interface SeasonState {
  number: number;
  startTick: number;
  status: 'active' | 'ended';
  endedTick: number | null;
  endReason: string;
}

// --- Senate (§11.3) -------------------------------------------------------

export interface SenateState {
  president: string | null;
  presidentSince: number;
  consecutiveTerms: number;
  termCount: number;
  nextSession: number;
  nextElection: number;
  resolutionLog: { tick: number; type: string; passed: boolean; text: string }[];
}

// --- Admirals (§9) --------------------------------------------------------

export type AdmiralSpec = 'gunnery' | 'carrier' | 'raider' | 'defense' | 'logistics';

export interface Admiral {
  id: string;
  empireId: string;
  name: string;
  level: number;
  spec: AdmiralSpec;
  fleetId?: string;
}

// --- Victory (§15) --------------------------------------------------------

export type VictoryReason = 'military' | 'diplomatic' | 'science' | 'economic';

export interface Victor {
  empireId: string;
  reason: VictoryReason;
  time: number;
}

// --- Diplomacy (§11) ------------------------------------------------------

export type TreatyType =
  | 'nonaggression'
  | 'trade'
  | 'research_exchange'
  | 'hypergate'
  | 'passage'
  | 'defensive'
  | 'military'
  | 'vassal';

export interface Treaty {
  id: string;
  a: string;
  b: string;
  type: TreatyType;
  since: number;
}

// --- Market (§16) ---------------------------------------------------------

export type Commodity = MaterialKind;

export interface Order {
  id: string;
  empireId: string;
  side: 'bid' | 'ask';
  commodity: Commodity;
  price: number;
  qty: number;
  time: number;
}

export interface Trade {
  commodity: Commodity;
  price: number;
  qty: number;
  buyer: string;
  seller: string;
}

export interface MarketState {
  /** Current NPC reference price per commodity. */
  prices: Record<Commodity, number>;
  orders: Order[];
  lastTrades: Trade[];
}

// --- Espionage (§12) ------------------------------------------------------

export type MissionKind = 'recon' | 'sabotage' | 'steal_tech';

export interface Agent {
  id: string;
  empireId: string;
  level: number;
  targetEmpireId?: string;
  mission?: MissionKind;
  progress: number;
  cooldown: number;
}

// --- Config (data/world-data.json) ---------------------------------------

export interface EconomyConfig {
  workersPerJob: number;
  /** Baseline construction points every colony has, so new colonies can bootstrap. */
  baseIp: number;
  energyBase: number;
  energyPerRegion: number;
  energyPerLevel: number;
  focusRegen: number;
  focusCap: number;
  baseCreditsPerColony: number;
  taxPerPop: number;
  upkeepPerRegionLevel: number;
  upkeepPerFleetPower: number;
  popGrowthDivisor: number;
  developBaseCost: number;
  developCostPerLevel: number;
  addRegionCost: number;
  fleetSpeed: number;
}

export interface BiomeDef {
  /** Farming fertility multiplier. */
  fertility: number;
  /** Bonus to gas extraction. */
  gasBonus: number;
  /** Base habitability 0..100 before race/gravity adjustment. */
  habitability: number;
}

export interface RaceDef {
  id: string;
  name: string;
  homeBiome: Biome;
  growthPct: number;
  /** Output multipliers as integer percent (100 = neutral). */
  mods: Partial<Record<'mining' | 'industry' | 'science' | 'farm' | 'trade' | 'growth', number>>;
  /** Habitability bonus on the race's preferred biome. */
  biomeAffinity: number;
}

export interface Recipe {
  id: string;
  inputs: Partial<Record<ResourceGroup, number>>;
  outputs: Partial<Record<MaterialKind, number>>;
  ipCost: number;
}

export interface TechDef {
  id: string;
  name: string;
  school: School;
  threshold: number;
  effect: string;
  /** Empire-wide output multiplier bonus (integer percent added). */
  bonus: Partial<Record<'mining' | 'industry' | 'science' | 'farm' | 'trade', number>>;
}

export interface RegionBaseDef {
  metals?: number;
  minerals?: number;
  gas?: number;
  organics?: number;
  exotic?: number;
  /** Food is produced directly by farms so survival is decoupled from industry. */
  food?: number;
  ip?: number;
  research?: number;
  popCap?: number;
  credits?: number;
  defense?: number;
}

export interface MarketConfig {
  basePrices: Record<Commodity, number>;
  /** NPC buy/sell spread, integer percent. */
  spreadPct: number;
  /** How strongly net supply moves the price (larger = slower). */
  driftDivisor: number;
  /** Materials each colony keeps before shipping surplus to the treasury. */
  colonyReserve: number;
  /** Fraction (percent) of surplus shipped to the treasury per tick. */
  shipPct: number;
  /** Treasury target the empire holds before auto-selling to the NPC market. */
  treasuryTarget: number;
}

export interface EspionageConfig {
  agentCost: number;
  missionTicks: number;
  baseSuccess: number;
  sabotageLoss: number;
}

export interface ProtectionConfig {
  ratingThreshold: number;
  graceTicks: number;
}

export interface SenateConfig {
  sessionInterval: number;
  termLength: number;
  taxRate: number;
  proposalFocusCost: number;
  sanctionTicks: number;
}

export interface AncientsConfig {
  firstRaidTick: number;
  raidInterval: number;
  raidPower: number;
  raidGrowth: number;
}

export interface ArchaeologyConfig {
  excavationPerTick: number;
  artifactThreshold: number;
  deviceChancePct: number;
  creditReward: number;
}

export interface ExpeditionConfig {
  count: number;
  baseDifficulty: number;
  difficultyStep: number;
  costCredits: number;
  durationTicks: number;
  minResearch: number;
}

export interface AdmiralConfig {
  cost: number;
  powerBonusPerLevel: number;
}

export interface VictoryConfig {
  militarySectorPct: number;
  militaryHoldTicks: number;
  economicSharePct: number;
  economicHoldTicks: number;
  /** Minimum galactic turnover before the economic share can count (anti early-win). */
  economicMinVolume: number;
}

export interface SeasonConfig {
  /** Hard length of a season in ticks (a season also ends on any victory). */
  lengthTicks: number;
  /** Legacy points for winning the season. */
  championLegacy: number;
  /** Max head-start percent legacy can grant next season (§15 caps at ~5%). */
  maxLegacyBonusPct: number;
  /** Legacy points required per +1% head start. */
  legacyPerBonusPct: number;
}

export interface WorldData {
  economy: EconomyConfig;
  regionBase: Record<RegionSpec, RegionBaseDef>;
  biomes: Record<Biome, BiomeDef>;
  gravityHabMod: Record<Gravity, number>;
  races: RaceDef[];
  recipes: Recipe[];
  techs: TechDef[];
  market: MarketConfig;
  espionage: EspionageConfig;
  protection: ProtectionConfig;
  senate: SenateConfig;
  ancients: AncientsConfig;
  archaeology: ArchaeologyConfig;
  expeditions: ExpeditionConfig;
  admirals: AdmiralConfig;
  victory: VictoryConfig;
  season: SeasonConfig;
}
