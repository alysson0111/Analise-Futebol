import { getDb, now } from "./_lib/firebase.js";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function cleanSignal(input) {
  return {
    key: String(input.key || ""),
    sourceId: String(input.sourceId || ""),
    home: String(input.home || ""),
    away: String(input.away || ""),
    league: String(input.league || ""),
    market: String(input.market || ""),
    marketLabel: String(input.marketLabel || ""),
    odd: Number(input.odd || 0),
    confidence: Number(input.confidence || 0),
    scoreText: String(input.scoreText || ""),
    liveStatus: String(input.liveStatus || ""),
    dateText: String(input.dateText || ""),
    stats: Array.isArray(input.stats) ? input.stats.map(String).slice(0, 20) : [],
    result: input.result === "green" || input.result === "red" ? input.result : "pendente",
    createdAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  };
}

async function listSignals(res) {
  const db = getDb();
  const snapshot = await db.collection("sinais").orderBy("createdAt", "desc").limit(300).get();
  const signals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  send(res, 200, { signals });
}

async function saveSignal(req, res) {
  const db = getDb();
  const record = cleanSignal(req.body || {});
  if (!record.key || !record.home || !record.away || !record.market) {
    return send(res, 400, { error: "Sinal incompleto." });
  }

  const doc = await db.collection("sinais").add({
    ...record,
    createdAt: now(),
    updatedAt: now()
  });

  send(res, 200, { id: doc.id, ...record });
}

async function updateResult(req, res) {
  const db = getDb();
  const { id, result } = req.body || {};
  if (!id || !["green", "red", "pendente"].includes(result)) {
    return send(res, 400, { error: "Resultado invalido." });
  }

  await db.collection("sinais").doc(String(id)).update({
    result,
    updatedAt: now()
  });

  send(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await listSignals(res);
    if (req.method === "POST") return await saveSignal(req, res);
    if (req.method === "PATCH") return await updateResult(req, res);
    return send(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    send(res, 500, { error: error.message || "Erro no banco de sinais." });
  }
}
