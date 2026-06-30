import { getDb, now } from "./_lib/firebase.js";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

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
  const signalLines = [
    ...(Array.isArray(analysis.linhas) ? analysis.linhas : []),
    ...(Array.isArray(input.signals) ? input.signals : []),
    ...(Array.isArray(input.signalLines) ? input.signalLines : [])
  ].map(String).filter(Boolean);
  const market = String(analysis.mercado || input.market || "");
  const normalizedSignalLines = market === "corners" && !signalLines.length
    ? ["Over 8.5 escanteios", "Over 9.5 escanteios", "Over 10.5 escanteios"]
    : [...new Set(signalLines)];
  const liveCorners = Number(input.liveCorners);

  return {
    key: String(input.key || ""),
    sourceId: String(input.sourceId || ""),
    source: String(input.source || ""),
    home: String(input.home || ""),
    away: String(input.away || ""),
    league: String(input.league || ""),
    market,
    marketLabel: String(analysis.label || input.marketLabel || ""),
    mlPick: String(analysis.mlPick || input.mlPick || ""),
    mlPickLabel: String(analysis.mlPickLabel || input.mlPickLabel || ""),
    odd: Number(analysis.odd || input.odd || 0),
    confidence: Number(analysis.confianca || input.confidence || 0),
    scoreText: String(input.scoreText || ""),
    liveStatus: String(input.liveStatus || ""),
    dateText: String(input.dateText || ""),
    stats: stats.map(String).filter(Boolean).slice(0, 20),
    signalLines: normalizedSignalLines.slice(0, 10),
    liveCorners: Number.isFinite(liveCorners) ? liveCorners : null,
    result: input.result === "green" || input.result === "red" ? input.result : "pendente",
    createdAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  };
}

function normalizeMarketName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function parseScoreTotal(scoreText) {
  const parts = String(scoreText || "").split("x").map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] : 0;
}

function getSignalSettlement(signal, game) {
  const market = normalizeMarketName(signal.market || signal.marketLabel);
  const totalGoals = Number.isFinite(Number(game.totalGoals)) ? Number(game.totalGoals) : parseScoreTotal(game.scoreText);
  const finished = FINISHED_STATUSES.has(String(game.apiStatus || "").toUpperCase());
  const corners = Number(game.liveCorners || 0);
  const [homeGoals, awayGoals] = String(game.scoreText || "").split("x").map((part) => Number(part.trim()));
  const mlResult = Number.isFinite(homeGoals) && Number.isFinite(awayGoals)
    ? (homeGoals > awayGoals ? "home" : awayGoals > homeGoals ? "away" : "draw")
    : "";

  if (market.includes("over05") || market.includes("+0.5")) {
    if (totalGoals >= 1) return "green";
    return finished ? "red" : "";
  }

  if (market.includes("over15") || market.includes("+1.5")) {
    if (totalGoals >= 2) return "green";
    return finished ? "red" : "";
  }

  if (market.includes("over25") || market.includes("+2.5")) {
    if (totalGoals >= 3) return "green";
    return finished ? "red" : "";
  }

  if (market.includes("under25") || market.includes("under2.5")) {
    if (totalGoals >= 3) return "red";
    return finished ? "green" : "";
  }

  if (market.includes("corner") || market.includes("escanteio")) {
    if (game.liveCorners === null || game.liveCorners === undefined || game.liveCorners === "") return "";
    if (corners >= 9) return "green";
    return finished ? "red" : "";
  }

  if (market === "ml" || market.includes("moneyline")) {
    if (!finished || !signal.mlPick || !mlResult) return "";
    return signal.mlPick === mlResult ? "green" : "red";
  }

  return "";
}

async function settleSignalsFromForebet(db, signals) {
  return signals;
}

async function listSignals(res) {
  const db = getDb();
  const snapshot = await db.collection("sinais").orderBy("createdAt", "desc").limit(300).get();
  const signals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const settledSignals = await settleSignalsFromForebet(db, signals);
  send(res, 200, { signals: settledSignals });
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
  const { id, result, scoreText, liveStatus, dateText, mlPick, mlPickLabel, liveCorners, signalLines } = readBody(req);
  if (!id || !["green", "red", "pendente"].includes(result)) {
    return send(res, 400, { error: "Resultado invalido." });
  }

  const update = {
    result,
    settledAtText: result === "pendente" ? "" : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    updatedAt: now()
  };

  if (scoreText) update.scoreText = String(scoreText);
  if (liveStatus) update.liveStatus = String(liveStatus);
  if (dateText) update.dateText = String(dateText);
  if (mlPick) update.mlPick = String(mlPick);
  if (mlPickLabel) update.mlPickLabel = String(mlPickLabel);
  if (Number.isFinite(Number(liveCorners))) update.liveCorners = Number(liveCorners);
  if (Array.isArray(signalLines)) update.signalLines = signalLines.map(String).filter(Boolean).slice(0, 10);

  await db.collection("sinais").doc(String(id)).update(update);

  send(res, 200, { ok: true, ...update });
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
