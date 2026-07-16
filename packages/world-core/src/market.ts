/**
 * Market layer (design prompt §16). Colonies ship material surplus into an
 * empire-level treasury (logistics, §5.4); empires then trade on a galactic
 * order book. A "Federation" market-maker (FED) provides a price band and soaks
 * unmatched flow (the NPC market), while empire-vs-empire orders match first —
 * so production asymmetry between races creates real trade and price movement.
 *
 * `matchOrders` is a pure, exhaustively testable engine.
 */
import type { Commodity, MarketConfig, MarketState, Order, Trade, WorldData, WorldState } from './types.js';
import { makeStock } from './colony.js';

export const FED = 'FED';
/** Materials that trade on the market (food stays local to feed colonies). */
export const TRADE_COMMODITIES: Commodity[] = ['alloys', 'fuel', 'electronics', 'composites'];

const MIN_HOLD = 30; // treasury reserve an empire tries to keep of each material

export function makeMarket(data: WorldData): MarketState {
  return { prices: { ...data.market.basePrices }, orders: [], lastTrades: [] };
}

export function npcSell(price: number, cfg: MarketConfig): number {
  return Math.max(1, Math.floor((price * (100 - cfg.spreadPct)) / 100));
}
export function npcBuy(price: number, cfg: MarketConfig): number {
  return Math.max(1, Math.ceil((price * (100 + cfg.spreadPct)) / 100));
}

/** Move colony material surplus (above a reserve) into the empire treasury. */
export function logisticsStep(world: WorldState, data: WorldData): void {
  const reserve = data.market.colonyReserve;
  for (const eid of Object.keys(world.empires).sort()) {
    const empire = world.empires[eid];
    if (empire.pirate) continue;
    for (const cid of empire.colonyIds) {
      const colony = world.colonies[cid];
      if (!colony) continue;
      for (const mat of TRADE_COMMODITIES) {
        const surplus = colony.stock[mat] - reserve;
        if (surplus > 0) {
          const ship = Math.floor((surplus * data.market.shipPct) / 100);
          colony.stock[mat] -= ship;
          empire.treasury[mat] += ship;
        }
      }
    }
  }
}

/**
 * Pure order-book matcher. Bids sort by price desc then seq asc; asks by price
 * asc then seq asc. A bid and ask cross when bid.price >= ask.price; they trade
 * at the midpoint. Self-trades (same empire) are skipped.
 */
export function matchOrders(orders: Order[]): Trade[] {
  const trades: Trade[] = [];
  const byCommodity = new Map<Commodity, Order[]>();
  for (const o of orders) {
    if (!byCommodity.has(o.commodity)) byCommodity.set(o.commodity, []);
    byCommodity.get(o.commodity)!.push(o);
  }
  for (const commodity of [...byCommodity.keys()].sort()) {
    const group = byCommodity.get(commodity)!;
    const bids = group.filter((o) => o.side === 'bid').sort((a, b) => b.price - a.price || a.time - b.time);
    const asks = group.filter((o) => o.side === 'ask').sort((a, b) => a.price - b.price || a.time - b.time);
    let i = 0;
    let j = 0;
    while (i < bids.length && j < asks.length) {
      const bid = bids[i];
      const ask = asks[j];
      if (bid.qty <= 0) { i++; continue; }
      if (ask.qty <= 0) { j++; continue; }
      if (bid.empireId === ask.empireId) { j++; continue; }
      if (bid.price < ask.price) break;
      const qty = Math.min(bid.qty, ask.qty);
      const price = Math.floor((bid.price + ask.price) / 2);
      trades.push({ commodity, price, qty, buyer: bid.empireId, seller: ask.empireId });
      bid.qty -= qty;
      ask.qty -= qty;
    }
  }
  return trades;
}

export function marketStep(world: WorldState, data: WorldData): void {
  const cfg = data.market;
  const empireIds = Object.keys(world.empires).filter((id) => !world.empires[id].pirate).sort();

  // Maintenance consumption creates ongoing demand (§16 material sink).
  for (const eid of empireIds) {
    const e = world.empires[eid];
    let pop = 0;
    let levels = 0;
    for (const cid of e.colonyIds) {
      const c = world.colonies[cid];
      if (!c) continue;
      pop += c.population;
      for (const r of c.regions) levels += r.level;
    }
    e.treasury.fuel = Math.max(0, e.treasury.fuel - Math.floor(pop / 40));
    e.treasury.electronics = Math.max(0, e.treasury.electronics - Math.floor(levels / 25));
  }

  // Build the order book.
  const orders: Order[] = [];
  let seq = 0;
  const mk = (empireId: string, side: 'bid' | 'ask', commodity: Commodity, price: number, qty: number): void => {
    if (qty <= 0) return;
    orders.push({ id: `o${world.time}_${seq}`, empireId, side, commodity, price, qty, time: seq });
    seq++;
  };

  for (const commodity of TRADE_COMMODITIES) {
    const price = world.market.prices[commodity];
    for (const eid of empireIds) {
      const e = world.empires[eid];
      const held = e.treasury[commodity];
      if (held > cfg.treasuryTarget) mk(eid, 'ask', commodity, npcSell(price, cfg), held - cfg.treasuryTarget);
      else if (held < MIN_HOLD) {
        const want = MIN_HOLD - held;
        const affordable = Math.floor(e.credits / npcBuy(price, cfg));
        mk(eid, 'bid', commodity, npcBuy(price, cfg), Math.max(0, Math.min(want, affordable)));
      }
    }
    // Federation market-maker soaks the rest at the price band.
    mk(FED, 'bid', commodity, npcSell(price, cfg), 100000);
    mk(FED, 'ask', commodity, npcBuy(price, cfg), 100000);
  }

  const trades = matchOrders(orders);

  // Settle trades and track Federation net flow for price drift.
  const fedNet: Record<string, number> = {};
  for (const t of trades) {
    settle(world, t);
    if (t.seller === FED) fedNet[t.commodity] = (fedNet[t.commodity] ?? 0) + t.qty; // FED sold -> demand
    if (t.buyer === FED) fedNet[t.commodity] = (fedNet[t.commodity] ?? 0) - t.qty; // FED bought -> supply
  }

  // Price drift toward supply/demand, clamped to a band.
  for (const commodity of TRADE_COMMODITIES) {
    const base = cfg.basePrices[commodity];
    const net = fedNet[commodity] ?? 0;
    let p = world.market.prices[commodity] + Math.trunc(net / cfg.driftDivisor);
    p = Math.max(Math.max(1, Math.floor(base / 2)), Math.min(base * 3, p));
    world.market.prices[commodity] = p;
  }

  world.market.orders = orders;
  world.market.lastTrades = trades;
}

function settle(world: WorldState, t: Trade): void {
  if (t.seller !== FED) {
    const s = world.empires[t.seller];
    if (s) {
      s.treasury[t.commodity] -= t.qty;
      s.credits += t.price * t.qty;
    }
  }
  if (t.buyer !== FED) {
    const b = world.empires[t.buyer];
    if (b) {
      b.treasury[t.commodity] += t.qty;
      b.credits -= t.price * t.qty;
    }
  }
}

/** Fresh empty treasury (helper for empire construction). */
export function emptyTreasury() {
  return makeStock();
}
