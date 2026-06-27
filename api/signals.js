import { getDb, now } from "./_lib/firebase.js";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

function cleanSignal(input) {
  const analysis = input.analise || {};
  const stats = [
    ...(Array.isArray(analysis.dadosJogo) ? analysis.dadosJogo : []),
    ...(Array.isArray(analysis.sinais) ? analysis.sinais : []),
    ...(Array.isArray(input.stats) ? input.stats : [])
  ];

  return {
    key: String(input.key || ""),
    sourceId: String(input.sourceId || ""),
    home: String(input.home || ""),
    away: String(input.away || ""),
    league: String(input.league || ""),
    market: String(analysis.mercado || input.market || ""),
    marketLabel: String(analysis.label || input.marketLabel || ""),
    odd: Number(analysis.odd || input.odd || 0),
    confidence: Number(analysis.confianca || input.confidence || 0),
    scoreText: String(input.scoreText || ""),
    liveStatus: String(input.liveStatus || ""),
    dateText: String(input.dateText || ""),
    stats: stats.map(String).filter(Boolean).slice(0, 20),
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
  const record = cleanSignal(readBody(req));
  if (!record.key || !record.home || !record.away || !record.market) {
    return send(res, 400, { error: "Sinal incompleto." });
  }

  const existing = await db.collection("sinais").where("key", "==", record.key).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    const previous = doc.data();
    const merged = {
      ...record,
      result: previous.result || record.result,
      createdAtText: previous.createdAtText || record.createdAtText
    };
    await doc.ref.update({
      ...merged,
      updatedAt: now()
    });
    return send(res, 200, { id: doc.id, ...previous, ...merged, duplicate: true });
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
  const { id, result } = readBody(req);
  if (!id || !["green", "red", "pendente"].includes(result)) {
    return send(res, 400, { error: "Resultado invalido." });
  }

  await db.collection("sinais").doc(String(id)).update({
    result,
    settledAtText: result === "pendente" ? "" : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    updatedAt: now()
  });

  send(res, 200, { ok: true });
}

async function deleteSignal(req, res) {
  const db = getDb();
  const { id } = readBody(req);
  if (!id) return send(res, 400, { error: "Informe o sinal para excluir." });

  await db.collection("sinais").doc(String(id)).delete();
  send(res, 200, { ok: true });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await listSignals(res);
    if (req.method === "POST") return await saveSignal(req, res);
    if (req.method === "PATCH") return await updateResult(req, res);
    if (req.method === "DELETE") return await deleteSignal(req, res);
    return send(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    send(res, 500, { error: error.message || "Erro no banco de sinais." });
  }
}
