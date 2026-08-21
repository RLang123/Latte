export type SoupSide = "left" | "right";
export type SoupPhase = "countdown" | "playing" | "finished";
export type SoupEventKind =
  "good" | "bad" | "fly" | "wind" | "boil" | "steam" | "pepper" | "ladle";
export type SoupEndReason =
  "spilled" | "out-of-bounds" | "inactive" | "disconnected";
export type Point = { x: number; y: number };
export type SoupInput = Point & { sequence: number };
export type SoupIngredient = Point & {
  id: number;
  kind: "carrot" | "mushroom" | "onion" | "herb" | "toast" | "soap" | "wrapper";
};
export type SoupEvent = {
  id: number;
  kind: SoupEventKind;
  warningAt: number;
  startsAt: number;
  endsAt: number;
  direction?: -1 | 1;
  target?: SoupSide;
  strength?: number;
  x?: number;
  y?: number;
  resolved?: boolean;
};
export type SoupSnapshot = {
  phase: SoupPhase;
  serverNow: number;
  startsAt: number;
  elapsedMs: number;
  seed: number;
  handles: Record<SoupSide, Point>;
  pot: Point & { angle: number };
  slosh: { offset: number; velocity: number };
  soupRemaining: number;
  events: SoupEvent[];
  ingredients: SoupIngredient[];
  ingredientsCaught: number;
  fliesDodged: number;
  endReason?: SoupEndReason;
};
export type SessionRecord = { durationMs: number; countries: [string, string] };
export type SessionRecords = {
  maze?: SessionRecord;
  howIsTheSoup?: SessionRecord;
};
export const GOOD_INGREDIENTS: SoupIngredient["kind"][] = [
  "carrot",
  "mushroom",
  "onion",
  "herb",
];
export const BAD_INGREDIENTS: SoupIngredient["kind"][] = [
  "toast",
  "soap",
  "wrapper",
];
export const EVENT_KINDS: SoupEventKind[] = [
  "good",
  "bad",
  "fly",
  "wind",
  "boil",
  "steam",
  "pepper",
  "ladle",
];
export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export const isSoupInput = (v: unknown): v is SoupInput => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v as object);
  if (
    keys.length !== 3 ||
    !keys.every((k) => k === "x" || k === "y" || k === "sequence")
  )
    return false;
  const p = v as SoupInput;
  return (
    isFiniteNumber(p.x) &&
    p.x >= 0 &&
    p.x <= 1 &&
    isFiniteNumber(p.y) &&
    p.y >= 0 &&
    p.y <= 1 &&
    Number.isInteger(p.sequence) &&
    p.sequence >= 0 &&
    p.sequence <= 2_147_483_647
  );
};
export const isSessionRecord = (v: unknown): v is SessionRecord =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v as object).length === 2 &&
  isFiniteNumber((v as SessionRecord).durationMs) &&
  (v as SessionRecord).durationMs >= 0 &&
  Array.isArray((v as SessionRecord).countries) &&
  (v as SessionRecord).countries.length === 2 &&
  (v as SessionRecord).countries.every(
    (c) => typeof c === "string" && c.length >= 2 && c.length <= 56,
  );
export type SoupModel = Omit<
  SoupSnapshot,
  "serverNow" | "phase" | "startsAt" | "elapsedMs" | "seed" | "endReason"
> & {
  outSince?: number;
  lastPot: Point & { angle: number };
  eventNo: number;
  nextEventAt: number;
  lastEventEndedAt: number;
};
export const initialSoupModel = (): SoupModel => ({
  handles: { left: { x: 0.28, y: 0.56 }, right: { x: 0.72, y: 0.56 } },
  pot: { x: 0.5, y: 0.56, angle: 0 },
  lastPot: { x: 0.5, y: 0.56, angle: 0 },
  slosh: { offset: 0, velocity: 0 },
  soupRemaining: 100,
  events: [],
  ingredients: [],
  ingredientsCaught: 0,
  fliesDodged: 0,
  eventNo: 0,
  nextEventAt: 9000,
  lastEventEndedAt: 0,
});
export const soupDifficulty = (ms: number) =>
  ms < 8000
    ? 0
    : ms < 25000
      ? 1
      : ms < 50000
        ? 2
        : ms < 90000
          ? 3
          : Math.min(5, 3 + (ms - 90000) / 60000);
export const eventGap = (difficulty: number) =>
  Math.max(2300, 6500 - Math.min(5, difficulty) * 650);
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const calculatePot = (left: Point, right: Point) => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
  angle: Math.max(
    -0.55,
    Math.min(
      0.55,
      Math.atan2(right.y - left.y, Math.max(0.18, right.x - left.x)),
    ),
  ),
});
export const isActive = (e: SoupEvent, elapsed: number) =>
  elapsed >= e.startsAt && elapsed < e.endsAt;
export const isWarning = (e: SoupEvent, elapsed: number) =>
  elapsed >= e.warningAt && elapsed < e.startsAt;
export const eventConflict = (a: SoupEventKind, b: SoupEventKind) =>
  a === b ||
  ((a === "ladle" || a === "wind") && (b === "ladle" || b === "wind")) ||
  ((a === "boil" || a === "pepper") && (b === "boil" || b === "pepper"));
export function createSoupEvent(
  kind: SoupEventKind,
  id: number,
  elapsed: number,
  random: () => number,
  fast = false,
): SoupEvent {
  const warning = fast ? 100 : kind === "good" || kind === "bad" ? 500 : 1000,
    duration = fast ? 350 : kind === "steam" || kind === "pepper" ? 1800 : 2600,
    direction: -1 | 1 = random() < 0.5 ? -1 : 1,
    target: SoupSide = random() < 0.5 ? "left" : "right";
  return {
    id,
    kind,
    warningAt: elapsed,
    startsAt: elapsed + warning,
    endsAt: elapsed + warning + duration,
    direction,
    target,
    strength: 0.12 + random() * 0.12,
    x: direction === 1 ? -0.1 : 1.1,
    y: kind === "ladle" ? 0.45 : 0.3 + random() * 0.35,
  };
}
export function addSoupEvent(
  model: SoupModel,
  kind: SoupEventKind,
  elapsed: number,
  random: () => number,
  fast = false,
) {
  const e = createSoupEvent(kind, ++model.eventNo, elapsed, random, fast);
  model.events.push(e);
  if (kind === "good" || kind === "bad")
    model.ingredients.push({
      id: e.id,
      kind:
        kind === "good"
          ? GOOD_INGREDIENTS[Math.floor(random() * GOOD_INGREDIENTS.length)]
          : BAD_INGREDIENTS[Math.floor(random() * BAD_INGREDIENTS.length)],
      x: 0.15 + random() * 0.7,
      y: 0.03,
    });
  return e;
}
export function scheduleSoupEvent(
  model: SoupModel,
  elapsed: number,
  random: () => number,
  forced?: SoupEventKind,
  fast = false,
) {
  const difficulty = soupDifficulty(elapsed);
  if ((!forced && difficulty === 0) || elapsed < model.nextEventAt) return;
  const active = model.events.filter((e) => elapsed < e.endsAt);
  const limit = difficulty >= 3 ? 2 : 1;
  if (active.length >= limit || elapsed < model.lastEventEndedAt + 700) return;
  const allowed = EVENT_KINDS.slice(
    0,
    difficulty === 1 ? 2 : difficulty === 2 ? 5 : 8,
  );
  let kind = forced ?? allowed[Math.floor(random() * allowed.length)];
  if (active.some((e) => eventConflict(e.kind, kind))) return;
  const e = addSoupEvent(model, kind, elapsed, random, fast);
  model.nextEventAt =
    elapsed + eventGap(difficulty) + random() * (fast ? 0 : 1800);
  return e;
}
export function stepSoup(model: SoupModel, dt: number, elapsed: number) {
  const seconds = Math.min(0.05, Math.max(0, dt / 1000)),
    pot = calculatePot(model.handles.left, model.handles.right),
    ax = (pot.x - model.lastPot.x) / Math.max(seconds, 0.001),
    angular = (pot.angle - model.lastPot.angle) / Math.max(seconds, 0.001),
    active = model.events.filter((e) => isActive(e, elapsed)),
    wind = active.find((e) => e.kind === "wind"),
    boil = active.some((e) => e.kind === "boil"),
    pepper = active.find((e) => e.kind === "pepper");
  const pepperMotion = pepper
      ? ((pepper.target === "left"
          ? model.handles.left.x
          : model.handles.right.x) -
          0.5) *
        0.08
      : 0,
    force =
      -pot.angle * 2.1 -
      ax * 0.18 -
      angular * 0.08 +
      (wind?.direction ?? 0) * (wind?.strength ?? 0) +
      (boil ? Math.sin(elapsed / 90) * 0.6 : 0) +
      pepperMotion;
  model.slosh.velocity += force * seconds;
  model.slosh.velocity *= Math.pow(0.78, seconds);
  model.slosh.offset += model.slosh.velocity * seconds;
  model.slosh.offset *= Math.pow(0.9, seconds);
  const excess =
    Math.max(0, Math.abs(model.slosh.offset) - 0.27) +
    Math.max(0, Math.abs(pot.angle) - 0.34) * 0.8;
  if (excess > 0)
    model.soupRemaining = Math.max(
      0,
      model.soupRemaining - excess * seconds * 13,
    );
  model.pot = pot;
  model.lastPot = { ...pot };
  for (const item of model.ingredients) {
    item.y += seconds * (0.1 + soupDifficulty(elapsed) * 0.012);
    if (wind)
      item.x +=
        seconds * (wind.direction ?? 0) * (wind.strength ?? 0.12) * 0.35;
  }
  model.ingredients = model.ingredients.filter((item) => {
    if (
      item.y > pot.y - 0.06 &&
      item.y < pot.y + 0.1 &&
      Math.abs(item.x - pot.x) < 0.14
    ) {
      if (GOOD_INGREDIENTS.includes(item.kind)) {
        model.soupRemaining = Math.min(100, model.soupRemaining + 2.5);
        model.ingredientsCaught++;
      } else model.soupRemaining = Math.max(0, model.soupRemaining - 5);
      return false;
    }
    return item.y < 1.05;
  });
  for (const e of active) {
    if ((e.kind === "fly" || e.kind === "ladle") && !e.resolved) {
      const progress = (elapsed - e.startsAt) / (e.endsAt - e.startsAt),
        from = e.direction === 1 ? -0.1 : 1.1,
        to = e.direction === 1 ? 1.1 : -0.1;
      e.x = from + (to - from) * progress;
      if (e.kind === "fly") e.y = e.y ?? 0.4;
      if (
        Math.hypot((e.x ?? 0) - pot.x, (e.y ?? 0) - pot.y) <
        (e.kind === "fly" ? 0.13 : 0.17)
      ) {
        e.resolved = true;
        if (e.kind === "fly")
          model.soupRemaining = Math.max(0, model.soupRemaining - 3);
        else {
          model.soupRemaining = Math.max(0, model.soupRemaining - 2);
          model.slosh.velocity += (e.direction ?? 1) * 0.8;
        }
      }
    }
  }
  for (const e of model.events) {
    if (elapsed >= e.endsAt && !e.resolved) {
      if (e.kind === "fly") model.fliesDodged++;
      e.resolved = true;
      model.lastEventEndedAt = Math.max(model.lastEventEndedAt, e.endsAt);
    }
  }
  model.events = model.events.filter((e) => elapsed < e.endsAt + 250);
}
export type SoupSources = { now: () => number; random: () => number };
export function advanceSoup(
  model: SoupModel,
  previousNow: number,
  sources: SoupSources,
) {
  const now = sources.now(),
    elapsed = now;
  scheduleSoupEvent(model, elapsed, sources.random);
  stepSoup(model, now - previousNow, elapsed);
  return now;
}
