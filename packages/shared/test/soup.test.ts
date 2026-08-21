import { describe, expect, it } from "vitest";
import {
  addSoupEvent,
  advanceSoup,
  createSoupEvent,
  eventConflict,
  eventGap,
  initialSoupModel,
  isActive,
  isWarning,
  mulberry32,
  scheduleSoupEvent,
  soupDifficulty,
  stepSoup,
  type SoupEventKind,
} from "../src/soup";
const fixed = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0.5;
};
const collideIngredient = (kind: "carrot" | "toast", soup = 50) => {
  const m = initialSoupModel();
  m.soupRemaining = soup;
  m.ingredients = [{ id: 1, kind, x: 0.5, y: 0.56 }];
  stepSoup(m, 50, 10_000);
  return m;
};
describe("soup event simulation", () => {
  it("catches a good ingredient and caps recovery at 100", () => {
    const a = collideIngredient("carrot", 50),
      b = collideIngredient("carrot", 99);
    expect(a.ingredientsCaught).toBe(1);
    expect(a.soupRemaining).toBe(52.5);
    expect(b.soupRemaining).toBe(100);
  });
  it("collides with a bad ingredient and loses soup", () =>
    expect(collideIngredient("toast", 50).soupRemaining).toBe(45));
  it("counts a fly that passes without collision as dodged", () => {
    const m = initialSoupModel();
    const e = addSoupEvent(m, "fly", 0, fixed(0.1, 0.1, 0.1));
    e.startsAt = 0;
    e.endsAt = 1000;
    e.y = 0.1;
    stepSoup(m, 50, 1100);
    expect(m.fliesDodged).toBe(1);
    expect(m.soupRemaining).toBe(100);
  });
  it("penalizes a fly collision exactly once", () => {
    const m = initialSoupModel();
    const e = addSoupEvent(m, "fly", 0, fixed(0.9, 0.1, 0.5));
    e.startsAt = 0;
    e.endsAt = 1000;
    e.y = 0.56;
    stepSoup(m, 50, 500);
    const after = m.soupRemaining;
    stepSoup(m, 50, 550);
    expect(after).toBe(97);
    expect(m.soupRemaining).toBe(after);
    expect(m.fliesDodged).toBe(0);
  });
  it("applies wind direction and strength to ingredients and slosh", () => {
    const run = (direction: -1 | 1, strength: number) => {
      const m = initialSoupModel();
      m.ingredients = [{ id: 1, kind: "carrot", x: 0.5, y: 0.1 }];
      m.events = [
        {
          id: 1,
          kind: "wind",
          warningAt: 0,
          startsAt: 0,
          endsAt: 1000,
          direction,
          strength,
        },
      ];
      stepSoup(m, 50, 500);
      return m;
    };
    const left = run(-1, 0.2),
      right = run(1, 0.2),
      weak = run(1, 0.1);
    expect(left.ingredients[0].x).toBeLessThan(0.5);
    expect(right.ingredients[0].x).toBeGreaterThan(0.5);
    expect(Math.abs(right.slosh.velocity)).toBeGreaterThan(
      Math.abs(weak.slosh.velocity),
    );
  });
  it("starts, sustains, and ends boiling force", () => {
    const m = initialSoupModel();
    m.events = [
      { id: 1, kind: "boil", warningAt: 0, startsAt: 100, endsAt: 300 },
    ];
    expect(isActive(m.events[0], 99)).toBe(false);
    stepSoup(m, 50, 150);
    const active = m.slosh.velocity;
    stepSoup(m, 50, 200);
    expect(m.slosh.velocity).not.toBe(active);
    stepSoup(m, 50, 301);
    expect(isActive(m.events[0], 301)).toBe(false);
  });
  it("starts and ends steam without obscuring lifecycle", () => {
    const e = createSoupEvent("steam", 1, 1000, fixed(0.5));
    expect(isWarning(e, 1000)).toBe(true);
    expect(isActive(e, e.startsAt)).toBe(true);
    expect(isActive(e, e.endsAt)).toBe(false);
  });
  it("targets pepper at one side and ends its effect", () => {
    const m = initialSoupModel();
    m.handles.left.x = 0.1;
    const e = addSoupEvent(m, "pepper", 0, fixed(0.1, 0.1));
    e.startsAt = 0;
    e.endsAt = 100;
    expect(e.target).toBe("left");
    stepSoup(m, 50, 50);
    const during = m.slosh.velocity;
    stepSoup(m, 50, 101);
    expect(during).not.toBe(0);
    expect(isActive(e, 101)).toBe(false);
  });
  it("moves a ladle along a warned path and applies one collision impulse", () => {
    const m = initialSoupModel();
    const e = addSoupEvent(m, "ladle", 0, fixed(0.9, 0.9, 0.5));
    e.startsAt = 0;
    e.endsAt = 1000;
    e.y = 0.56;
    expect(e.x).toBe(-0.1);
    stepSoup(m, 50, 500);
    expect(e.resolved).toBe(true);
    expect(m.soupRemaining).toBe(98);
    const velocity = m.slosh.velocity;
    stepSoup(m, 50, 550);
    expect(m.soupRemaining).toBe(98);
    expect(Math.abs(velocity)).toBeGreaterThan(0.5);
  });
  it("provides a warning interval before every event", () => {
    for (const kind of [
      "good",
      "bad",
      "fly",
      "wind",
      "boil",
      "steam",
      "pepper",
      "ladle",
    ] as SoupEventKind[]) {
      const e = createSoupEvent(kind, 1, 1000, fixed(0.5));
      expect(e.warningAt).toBe(1000);
      expect(e.startsAt).toBeGreaterThan(e.warningAt);
      expect(isWarning(e, e.startsAt - 1)).toBe(true);
    }
  });
  it("enforces a recovery gap after an event", () => {
    const m = initialSoupModel();
    m.nextEventAt = 0;
    m.lastEventEndedAt = 1000;
    expect(scheduleSoupEvent(m, 1600, fixed(0.1), "good")).toBeUndefined();
    expect(scheduleSoupEvent(m, 1700, fixed(0.1), "good")).toBeDefined();
  });
  it("never combines forbidden event pairs", () => {
    expect(eventConflict("wind", "ladle")).toBe(true);
    expect(eventConflict("boil", "pepper")).toBe(true);
    const m = initialSoupModel();
    m.nextEventAt = 0;
    m.events = [
      { id: 1, kind: "wind", warningAt: 0, startsAt: 0, endsAt: 20_000 },
    ];
    expect(scheduleSoupEvent(m, 10_000, fixed(0.1), "ladle")).toBeUndefined();
  });
  it("uses difficulty-based frequency with a maximum cap", () => {
    expect(eventGap(soupDifficulty(9000))).toBeGreaterThan(
      eventGap(soupDifficulty(100_000)),
    );
    expect(soupDifficulty(99_999_999)).toBe(5);
    expect(eventGap(100)).toBe(eventGap(5));
  });
  it("reproduces identical results for the same seed and fake clock", () => {
    const run = () => {
      const m = initialSoupModel(),
        random = mulberry32(77);
      let now = 0;
      for (let i = 0; i < 2400; i++) {
        const previous = now;
        now += 50;
        advanceSoup(m, previous, { now: () => now, random });
      }
      return m;
    };
    expect(run()).toEqual(run());
  });
});
