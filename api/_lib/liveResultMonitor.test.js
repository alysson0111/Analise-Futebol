import test from "node:test";
import assert from "node:assert/strict";
import { monitoringDay, selectLiveMonitoringCandidates, runLiveResultMonitor } from "./liveResultMonitor.js";
import { authorizedCron } from "../cron-results.js";

const row = (status = "90") => ({ league: "Liga", home: "Casa", away: "Fora", time: "12:00", status, homeGoals: 2, awayGoals: 1, homeCorners: 5, awayCorners: 4, handicapLine: 0, cornerLine: 9.5 });
const sourceId = "totalcorner-Liga-Casa-Fora-12:00";

function fakeDb() {
  const signals = new Map([
    ["today", { sourceId, home: "Casa", away: "Fora", dateText: "11/10/2026", market: "over25", result: "pendente", scoreText: "0x0", entryScoreText: "0x0", odd: 1.8, createdAt: "2026-10-11T14:00:00Z" }],
    ["old", { sourceId, home: "Casa", away: "Fora", dateText: "01/07/2026", market: "over25", result: "pendente", scoreText: "0x0" }]
  ]);
  let state;
  let sourceQueries = 0;
  let finalReads = 0;
  const copy = (data) => data ? JSON.parse(JSON.stringify(data)) : undefined;
  const snapshot = (ref) => ({ id: ref.id, ref, exists: ref.kind === "runtime" ? Boolean(state) : signals.has(ref.id), data: () => copy(ref.kind === "runtime" ? state : signals.get(ref.id)) });
  const reference = (kind, id) => ({ kind, id, async set(data) { state = copy(data); } });
  const db = {
    signals,
    readTime: new Date("2026-10-11T15:00:00Z"),
    get state() { return state; },
    get sourceQueries() { return sourceQueries; },
    get finalReads() { return finalReads; },
    collection(kind) {
      return {
        doc: (id) => reference(kind, id),
        where(field, operator, value) {
          let after;
          let size;
          const query = {
            orderBy() { return this; },
            startAfter(doc) { after = doc.id; return this; },
            limit(limit) { size = limit; return this; },
            async get() {
              if (field === "sourceId") sourceQueries++;
              let entries = [...signals].filter(([, data]) => operator === "=="
                ? data[field] === value
                : data[field] && new Date(data[field]) >= value);
              if (after) entries = entries.slice(entries.findIndex(([id]) => id === after) + 1);
              return { docs: entries.slice(0, size).map(([id]) => snapshot(reference("sinais", id))), readTime: { toDate: () => db.readTime } };
            }
          };
          return query;
        }
      };
    },
    async runTransaction(callback) {
      return callback({ get: async (ref) => snapshot(ref), set: (_ref, data) => { state = copy(data); } });
    },
    async getAll(...refs) { finalReads += refs.length; return refs.map(snapshot); },
    batch() {
      const changes = [];
      return { update(ref, update) { changes.push([ref.id, update]); }, async commit() { changes.forEach(([id, update]) => signals.set(id, { ...signals.get(id), ...update })); } };
    }
  };
  return db;
}

test("today follows Brasilia, not the UTC calendar", () => {
  assert.deepEqual(monitoringDay(new Date("2026-10-12T02:59:00Z")), { text: "11/10/2026", iso: "2026-10-11" });
});

test("only live matches of today at 90+ enter monitoring; historical and already-final games do not", () => {
  const game = { dateText: "11/10/2026", sourceId, elapsed: 90, apiStatus: "LIVE" };
  const selected = selectLiveMonitoringCandidates([game, { ...game, elapsed: 89 }, { ...game, dateText: "10/10/2026" }, { ...game, apiStatus: "FT" }, { ...game, apiStatus: "NS" }], "11/10/2026");
  assert.deepEqual(selected, [game]);
});

test("monitor persists through independent invocations and confirms disappeared matches without touching history", async () => {
  const db = fakeDb();
  let time = new Date("2026-10-11T15:00:00Z");
  let rows = [row("89")];
  let finalQueries = 0;
  const options = { db, clock: () => { db.readTime = time; return time; }, fetchLive: async () => rows, fetchDate: async (dateIso) => { finalQueries++; assert.equal(dateIso, "2026-10-11"); return rows.length ? rows.map((item) => ({ ...item, dateIso })) : [{ ...row("Fim"), dateIso }]; } };
  await runLiveResultMonitor(options);
  assert.equal(db.sourceQueries, 0);
  time = new Date(time.getTime() + 60000);
  rows = [row("90")];
  let result = await runLiveResultMonitor(options);
  assert.equal(result.watched, 1);
  assert.equal(db.signals.get("today").scoreText, "0x0");
  assert.equal(db.sourceQueries, 0);
  time = new Date(time.getTime() + 60000);
  rows = [row("94")];
  await runLiveResultMonitor(options);
  assert.equal(db.sourceQueries, 0);
  assert.equal(db.finalReads, 0);
  db.signals.set("late", { ...db.signals.get("today"), market: "over15", createdAt: time.toISOString() });
  time = new Date(time.getTime() + 60000);
  rows = [];
  result = await runLiveResultMonitor(options);
  assert.equal(result.updated, 2);
  assert.equal(result.watched, 0);
  assert.equal(finalQueries, 3);
  assert.equal(db.signals.get("today").result, "green");
  assert.equal(db.signals.get("today").scoreText, "2x1");
  assert.equal(db.signals.get("today").entryScoreText, "0x0");
  assert.equal(db.signals.get("today").odd, 1.8);
  assert.equal(db.signals.get("late").result, "green");
  assert.equal(db.signals.get("old").result, "pendente");
});

test("a today's game that finished before the monitor saw minute 90 is recovered", async () => {
  const db = fakeDb();
  const result = await runLiveResultMonitor({ db, clock: () => db.readTime, fetchLive: async () => [], fetchDate: async (dateIso) => [{ ...row("FT"), dateIso }] });
  assert.equal(result.updated, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(db.signals.get("today").result, "green");
  assert.equal(db.signals.get("old").result, "pendente");
});

test("more than 60 matches are tracked and settled without excluding later matches", async () => {
  const db = fakeDb();
  const rows = [];
  for (let i = 0; i < 75; i++) {
    const home = `Casa ${i}`;
    db.signals.set(`extra${i}`, { ...db.signals.get("today"), home, sourceId: `totalcorner-Liga-${home}-Fora-12:00` });
    rows.push({ ...row("FT"), home, dateIso: "2026-10-11" });
  }
  const result = await runLiveResultMonitor({ db, clock: () => db.readTime, fetchLive: async () => [], fetchDate: async () => [{ ...row("FT"), dateIso: "2026-10-11" }, ...rows] });
  assert.equal(result.updated, 76);
  assert.equal(result.watched, 0);
});

test("a live-source failure does not prevent confirmation from today's results", async () => {
  const db = fakeDb();
  const result = await runLiveResultMonitor({ db, clock: () => db.readTime, fetchLive: async () => { throw Error("Live timeout"); }, fetchDate: async (dateIso) => [{ ...row("FT"), dateIso }] });
  assert.equal(result.updated, 1);
  assert.deepEqual(result.errors, ["Live timeout"]);
});

test("pagination and settlement batches eventually handle all today's pending signals", async () => {
  const db = fakeDb();
  for (let i = 0; i < 550; i++) db.signals.set(`extra${i}`, { ...db.signals.get("today") });
  const options = { db, clock: () => db.readTime, fetchLive: async () => [], fetchDate: async (dateIso) => [{ ...row("FT"), dateIso }] };
  assert.equal((await runLiveResultMonitor(options)).updated, 300);
  db.readTime = new Date(db.readTime.getTime() + 60000);
  assert.equal((await runLiveResultMonitor(options)).updated, 251);
  assert.equal(db.state.monitors.length, 0);
  assert.equal(db.signals.get("old").result, "pendente");
});

test("disappearing from live does not imply FT; a failed result lookup keeps the signal pending", async () => {
  const db = fakeDb();
  let time = new Date("2026-10-11T15:00:00Z");
  let rows = [row("90")];
  const options = { db, clock: () => time, fetchLive: async () => rows, fetchDate: async () => { throw Error("Fonte indisponivel"); } };
  await runLiveResultMonitor(options);
  time = new Date(time.getTime() + 60000);
  rows = [];
  const result = await runLiveResultMonitor(options);
  assert.equal(result.updated, 0);
  assert.equal(result.watched, 1);
  assert.equal(db.signals.get("today").result, "pendente");
  assert.deepEqual(result.errors, ["Fonte indisponivel"]);
  assert.equal(db.state.lockUntil, 0);
});

test("duplicate ticks are skipped and previous-day monitors are not resumed", async () => {
  const db = fakeDb();
  let time = new Date("2026-10-11T15:00:00Z");
  const options = { db, clock: () => time, fetchLive: async () => [row("90")], fetchDate: async () => [] };
  await runLiveResultMonitor(options);
  assert.equal((await runLiveResultMonitor(options)).skipped, true);
  time = new Date("2026-10-12T15:00:00Z");
  const result = await runLiveResultMonitor({ ...options, fetchLive: async () => [] });
  assert.equal(result.watched, 0);
  assert.equal(db.signals.get("today").result, "pendente");
});

test("cron requires the exact bearer secret and fails closed without configuration", () => {
  assert.equal(authorizedCron("Bearer correct", "correct"), true);
  assert.equal(authorizedCron("Bearer wrong", "correct"), false);
  assert.equal(authorizedCron(undefined, "correct"), false);
  assert.equal(authorizedCron("Bearer undefined", undefined), false);
});

test("later schedule pages are checked on subsequent ticks and recover missing matches", async () => {
  const db = fakeDb();
  const base = "https://www.totalcorner.com/pt/match/schedule/20261011";
  const pageTwo = `${base}/p.2`;
  const requested = [];
  const options = {
    db, clock: () => db.readTime, fetchLive: async () => [],
    fetchDate: async (dateIso, { pageUrl }) => {
      requested.push(pageUrl || base);
      const rows = pageUrl === pageTwo ? [{ ...row("FT"), dateIso }] : [];
      rows.pages = [base, pageTwo];
      return rows;
    }
  };
  assert.equal((await runLiveResultMonitor(options)).updated, 0);
  assert.equal(db.state.resultPage, pageTwo);
  db.readTime = new Date(db.readTime.getTime() + 60000);
  assert.equal((await runLiveResultMonitor(options)).updated, 1);
  assert.deepEqual(requested, [base, pageTwo]);
  assert.equal(db.signals.get("today").result, "green");
});
