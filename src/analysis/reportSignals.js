export function mergeReportSignals(current, incoming, deletedIds = new Set()) {
  const records = new Map(current.filter((signal) => !deletedIds.has(signal.id)).map((signal) => [signal.id, signal]));
  for (const signal of incoming) {
    if (deletedIds.has(signal.id)) continue;
    const previous = records.get(signal.id);
    if (previous?.finalConfirmed && !signal.finalConfirmed) continue;
    const previousTime = previous?.updatedAt?._seconds || 0;
    const incomingTime = signal.updatedAt?._seconds || 0;
    if (previousTime > incomingTime) continue;
    records.set(signal.id, { ...previous, ...signal });
  }
  return [...records.values()].sort((a, b) => (b.createdAt?._seconds || 0) - (a.createdAt?._seconds || 0));
}
