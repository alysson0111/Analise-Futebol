import { analyzeFixtures } from "./scanner.js";
import { fetchTotalCornerToday, fetchTotalCornerDate, totalCornerRowsToFixtures } from "./totalCorner.js";
import { findResultGame } from "./signalResultLookup.js";
import { buildFinalSignalUpdate, isFinishedGame } from "../../src/analysis/signalSettlement.js";
import { now } from "./firebase.js";

export function monitoringDay(date = new Date()) {
  const text = date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const [day, month, year] = text.split("/");
  return { text, iso: `${year}-${month}-${day}` };
}

export function selectLiveMonitoringCandidates(games, day) {
  const selected = new Map();
  for (const game of games) {
    if (game.dateText !== day || isFinishedGame(game)) continue;
    if (!["LIVE", "2H", "ET", "BT"].includes(game.apiStatus)) continue;
    if (Number(game.elapsed) < 90 || !game.sourceId) continue;
    selected.set(game.sourceId, game);
  }
  return [...selected.values()];
}

function matchesMonitor(monitor, games) {
  return findResultGame({ ...monitor, market: "over05" }, games);
}

export async function runLiveResultMonitor({ db, fetchLive = fetchTotalCornerToday, fetchDate = fetchTotalCornerDate, clock = () => new Date() }) {
  const started = clock();
  const day = monitoringDay(started);
  const ref = db.collection("runtime").doc("live-results");
  const lockUntil = started.getTime() + 120000;
  const state = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() : {};
    if (Number(previous.lockUntil) > started.getTime()) return null;
    if (Number(previous.lastStartedAt) > started.getTime() - 55000) return null;
    const current = previous.dateText === day.text ? previous : { dateText: day.text, monitors: [], completed: [] };
    transaction.set(ref, { ...current, lockUntil, lastStartedAt: started.getTime() });
    return current;
  });
  if (!state) return { skipped: true, reason: "Execucao ja iniciada neste minuto." };

  const monitors = [...(state.monitors || [])];
  const completed = new Set(state.completed || []);
  const summary = { date: day.text, updated: 0, watched: 0, errors: [] };
  try {
    const liveRows = await fetchLive();
    const liveGames = analyzeFixtures({ response: totalCornerRowsToFixtures(liveRows.map((row) => ({ ...row, dateIso: day.iso }))) });
    const candidates = selectLiveMonitoringCandidates(liveGames, day.text)
      .filter((game) => !completed.has(game.sourceId) && !monitors.some((monitor) => monitor.sourceId === game.sourceId))
      .slice(0, Math.max(0, Math.min(10, 60 - monitors.length)));
    for (const game of candidates) {
      const snapshot = await db.collection("sinais").where("sourceId", "==", game.sourceId).limit(200).get();
      const signalIds = snapshot.docs.filter((doc) => {
        const signal = doc.data();
        return signal.dateText === day.text && signal.result === "pendente" && !signal.finalConfirmed;
      }).map((doc) => doc.id);
      if (signalIds.length) monitors.push({ sourceId: game.sourceId, home: game.home, away: game.away, dateText: day.text, signalIds });
    }

    let finalGames = [];
    if (monitors.some((monitor) => !matchesMonitor(monitor, liveGames))) {
      try {
        const rows = await fetchDate(day.iso);
        finalGames = analyzeFixtures({ response: totalCornerRowsToFixtures(rows) });
      } catch (error) {
        summary.errors.push(error.message);
      }
    }

    for (const monitor of monitors) {
      const game = matchesMonitor(monitor, [...finalGames, ...liveGames]);
      if (!game || !isFinishedGame(game)) continue;
      const snapshot = await db.collection("sinais").where("sourceId", "==", monitor.sourceId).limit(200).get();
      const docs = snapshot.docs;
      const remaining = [];
      const batch = db.batch();
      let count = 0;
      for (const doc of docs) {
        if (!doc.exists) continue;
        const signal = doc.data();
        if (signal.dateText !== day.text || signal.result !== "pendente" || signal.finalConfirmed) continue;
        const update = buildFinalSignalUpdate(signal, game);
        if (!update) { remaining.push(doc.id); continue; }
        batch.update(doc.ref, { ...update, settledAtText: clock().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), updatedAt: now() });
        count++;
      }
      if (count) await batch.commit();
      summary.updated += count;
      monitor.signalIds = remaining;
      if (!remaining.length) completed.add(monitor.sourceId);
    }
  } catch (error) {
    summary.errors.push(error.message || "Falha ao consultar jogos ao vivo.");
  } finally {
    const active = monitors.filter((monitor) => monitor.signalIds.length);
    summary.watched = active.length;
    await ref.set({ dateText: day.text, monitors: active, completed: [...completed], lockUntil: 0, lastStartedAt: started.getTime(), lastRunAt: clock().toISOString(), lastSummary: summary });
  }
  return summary;
}
