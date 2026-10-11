import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { getDb } from "./_lib/firebase.js";
import { runLiveResultMonitor } from "./_lib/liveResultMonitor.js";

export function authorizedCron(header, secret) {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(String(header || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (!authorizedCron(req.headers.authorization, process.env.CRON_SECRET)) return send(403, { error: "Acesso negado." });
  if (req.method !== "GET") return send(405, { error: "Metodo nao permitido." });
  try {
    const db = getDb();
    const params = new URL(req.url || "/api/cron-results", "http://localhost").searchParams;
    if (params.get("status") === "1") {
      const snapshot = await db.collection("runtime").doc("live-results").get();
      const state = snapshot.exists ? snapshot.data() : {};
      return send(200, { lastRunAt: state.lastRunAt || null, summary: state.lastSummary || null });
    }
    const task = runLiveResultMonitor({ db });
    if (params.get("wait") !== "1") {
      waitUntil(task.then((result) => console.info("Live result monitor", JSON.stringify(result))).catch((error) => console.error("Live result monitor", error.message)));
      return send(202, { accepted: true });
    }
    const result = await task;
    return send(result.errors?.length ? 502 : 200, result);
  } catch (error) {
    return send(503, { error: error.message || "Falha ao atualizar resultados." });
  }
}
