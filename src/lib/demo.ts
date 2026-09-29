export function shiftEventsToNow<T extends { ts: number }>(
  events: T[],
  now = Date.now(),
): T[] {
  if (!events.length) return events;
  const newest = Math.max(...events.map((e) => e.ts));
  const shift = now - newest;
  return events.map((event) => ({ ...event, ts: event.ts + shift }));
}
