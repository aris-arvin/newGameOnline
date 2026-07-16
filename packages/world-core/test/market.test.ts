import { describe, it, expect } from 'vitest';
import { matchOrders, npcBuy, npcSell } from '../src/market.js';
import type { Order } from '../src/types.js';

function order(over: Partial<Order> & Pick<Order, 'empireId' | 'side' | 'price' | 'qty'>): Order {
  return { id: over.id ?? `${over.empireId}-${over.side}`, commodity: over.commodity ?? 'alloys', time: over.time ?? 0, ...over };
}

describe('order-book matcher', () => {
  it('matches a crossing bid/ask at the midpoint', () => {
    const trades = matchOrders([
      order({ empireId: 'A', side: 'bid', price: 10, qty: 5, time: 0 }),
      order({ empireId: 'B', side: 'ask', price: 8, qty: 5, time: 1 }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ buyer: 'A', seller: 'B', price: 9, qty: 5 });
  });

  it('does not match when the bid is below the ask', () => {
    expect(
      matchOrders([
        order({ empireId: 'A', side: 'bid', price: 5, qty: 5, time: 0 }),
        order({ empireId: 'B', side: 'ask', price: 8, qty: 5, time: 1 }),
      ]),
    ).toHaveLength(0);
  });

  it('skips self-trades', () => {
    expect(
      matchOrders([
        order({ empireId: 'A', side: 'bid', price: 10, qty: 5, time: 0 }),
        order({ empireId: 'A', side: 'ask', price: 8, qty: 5, time: 1 }),
      ]),
    ).toHaveLength(0);
  });

  it('fills partially against the smaller side', () => {
    const trades = matchOrders([
      order({ empireId: 'A', side: 'bid', price: 10, qty: 3, time: 0 }),
      order({ empireId: 'B', side: 'ask', price: 9, qty: 5, time: 1 }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0].qty).toBe(3);
  });

  it('NPC spread makes buying dearer than selling', () => {
    const cfg = { basePrices: {} as never, spreadPct: 12, driftDivisor: 40, colonyReserve: 60, shipPct: 50, treasuryTarget: 120 };
    expect(npcBuy(10, cfg)).toBeGreaterThan(npcSell(10, cfg));
  });
});
