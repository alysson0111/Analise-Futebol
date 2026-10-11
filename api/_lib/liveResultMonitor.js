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

async function discoverPendingSignals(db, state, day) {
  const collection = db.collection("sinais");
  const query = state.signalCursor
    ? collection.where("createdAt", ">=", new Date(state.signalCursor)).orderBy("createdAt", "asc")
    : collection.where("dateText", "==", day.text);
  const signals = [];
  let page;
  let cursor;
  let nextCursor;
  do {
    page = await (cursor ? query.startAfter(cursor) : query).limit(500).get();
    for (const doc of page.docs) {
      const signal = doc.data();
      if (signal.dateText === day.text && signal.result === "pendente" && !signal.finalConfirmed && signal.sourceId) {
        signals.push({ id: doc.id, ...signal });
      }
    }
    // Overlap pages with the next poll so creations during discovery cannot be lost.
    nextCursor ||= page.readTime.toDate().toISOString();
    cursor = page.docs.at(-1);
  } while (page.docs.length === 500);
  return { signals, cursor: nextCursor };
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
  let signalCursor = state.signalCursor;
  let resultPage = state.paginationVersion === 2 ? state.resultPage : undefined;
  let resultPages = state.paginationVersion === 2 ? state.resultPages || [] : [];
  const summary = { date: day.text, updated: 0, watched: 0, unmatched: 0, awaitingFinal: 0, incomplete: 0, errors: [] };
  try {
    const discovery = await discoverPendingSignals(db, { signalCursor }, day);
    signalCursor = discovery.cursor;
    for (const signal of discovery.signals) {
      let monitor = monitors.find((item) => item.sourceId === signal.sourceId);
      if (!monitor) {
        monitor = { sourceId: signal.sourceId, home: signal.home, away: signal.away, dateText: day.text, signalIds: [] };
        monitors.push(monitor);
      }
      if (!monitor.signalIds.includes(signal.id)) monitor.signalIds.push(signal.id);
    }

    let liveGames = [];
    if (monitors.length) {
      try {
        const liveRows = await fetchLive();
        liveGames = analyzeFixtures({ response: totalCornerRowsToFixtures(liveRows.map((row) => ({ ...row, dateIso: day.iso }))) });
      } catch (error) {
        summary.errors.push(error.message);
      }
    }
    let finalGames = [];
    if (monitors.some((monitor) => {
      const game = matchesMonitor(monitor, liveGames);
      return !game || (!isFinishedGame(game) && Number(game.elapsed) >= 90);
    })) {
      try {
        const rows = await fetchDate(day.iso, { pageUrl: resultPage });
        if (rows.pages?.length) {
          resultPages = [...new Set([...resultPages, ...rows.pages])].sort();
          const index = Math.max(0, resultPages.indexOf(resultPage || resultPages[0]));
          summary.resultPages = resultPages.length;
          summary.resultPage = resultPage || resultPages[0];
          resultPage = resultPages[(index + 1) % resultPages.length];
        }
        finalGames = analyzeFixtures({ response: totalCornerRowsToFixtures(rows) });
      } catch (error) {
        summary.errors.push(error.message);
      }
    }

    const finalMonitors = [];
    for (const monitor of monitors) {
      const game = matchesMonitor(monitor, [...finalGames, ...liveGames]);
      if (!game) { summary.unmatched++; continue; }
      if (!isFinishedGame(game)) { summary.awaitingFinal++; continue; }
      finalMonitors.push({ monitor, game });
    }
    const refs = finalMonitors.flatMap(({ monitor }) => monitor.signalIds.map((id) => db.collection("sinais").doc(id)));
    const documents = new Map();
    for (let i = 0; i < refs.length; i += 200) {
      const docs = await db.getAll(...refs.slice(i, i + 200));
      docs.forEach((doc) => documents.set(doc.id, doc));
    }
    const batch = db.batch();
    const remainingByMonitor = new Map();
    let count = 0;
    for (const { monitor, game } of finalMonitors) {
      const remaining = [];
      for (const id of monitor.signalIds) {
        const doc = documents.get(id);
        if (!doc?.exists) continue;
        const signal = doc.data();
        if (signal.dateText !== day.text || signal.result !== "pendente" || signal.finalConfirmed) continue;
        if (count >= 300) { remaining.push(doc.id); continue; }
        const update = buildFinalSignalUpdate(signal, game);
        if (!update) { remaining.push(doc.id); summary.incomplete++; continue; }
        batch.update(doc.ref, { ...update, settledAtText: clock().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), updatedAt: now() });
        count++;
      }
      remainingByMonitor.set(monitor, remaining);
    }
    if (count) await batch.commit();
    summary.updated = count;
    remainingByMonitor.forEach((ids, monitor) => { monitor.signalIds = ids; });
  } catch (error) {
    summary.errors.push(error.message || "Falha ao consultar jogos ao vivo.");
  } finally {
    const active = monitors.filter((monitor) => monitor.signalIds.length);
    summary.watched = active.length;
    await ref.set({ dateText: day.text, monitors: active, ...(signalCursor ? { signalCursor } : {}), ...(resultPage ? { resultPage, resultPages, paginationVersion: 2 } : {}), lockUntil: 0, lastStartedAt: started.getTime(), lastRunAt: clock().toISOString(), lastSummary: summary });
  }
  return summary;
}
