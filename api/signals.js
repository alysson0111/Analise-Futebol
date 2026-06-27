import { getDb, now } from "./_lib/firebase.js";

const API_FIXTURES = "https://v3.football.api-sports.io/fixtures";
const API_STATISTICS = "https://v3.football.api-sports.io/fixtures/statistics";
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

function normalizeMarketName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function parseScoreTotal(scoreText) {
  const parts = String(scoreText || "").split("x").map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] : 0;
}

function getStatTotal(stats, type) {
  return (stats || []).reduce((sum, teamStats) => {
    const item = (teamStats.statistics || []).find((stat) => stat.type === type);
    return sum + Number(item?.value || 0);
  }, 0);
}

function getSignalSettlement(signal, game) {
  const market = normalizeMarketName(signal.market || signal.marketLabel);
  const totalGoals = Number.isFinite(Number(game.totalGoals)) ? Number(game.totalGoals) : parseScoreTotal(game.scoreText);
  const finished = FINISHED_STATUSES.has(String(game.apiStatus || "").toUpperCase());
  const corners = Number(game.liveCorners || 0);

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
    if (corners >= 9) return "green";
    return finished ? "red" : "";
  }

  return "";
}

async function fetchFixtureState(sourceId, token) {
  const response = await fetch(`${API_FIXTURES}?id=${encodeURIComponent(sourceId)}`, {
    headers: { "x-apisports-key": token }
  });
  if (!response.ok) return null;

  const payload = await response.json();
  const row = payload.response?.[0];
  if (!row) return null;

  let stats = [];
  try {
    const statsResponse = await fetch(`${API_STATISTICS}?fixture=${encodeURIComponent(sourceId)}`, {
      headers: { "x-apisports-key": token }
    });
    if (statsResponse.ok) {
      const statsPayload = await statsResponse.json();
      stats = statsPayload.response || [];
    }
  } catch {
    stats = [];
  }

  const homeGoals = Number(row.goals?.home || 0);
  const awayGoals = Number(row.goals?.away || 0);
  const elapsed = Number(row.fixture?.status?.elapsed || 0);
  const apiStatus = String(row.fixture?.status?.short || "");
  const kickoff = row.fixture?.date ? new Date(row.fixture.date) : null;

  return {
    scoreText: `${homeGoals}x${awayGoals}`,
    totalGoals: homeGoals + awayGoals,
    liveStatus: elapsed ? `${elapsed}'` : apiStatus,
    apiStatus,
    liveCorners: getStatTotal(stats, "Corner Kicks"),
    dateText: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toLocaleDateString("pt-BR") : ""
  };
}

async function settleSignalsFromApi(db, signals) {
  const token = process.env.API_FOOTBALL_KEY;
  if (!token) return signals;

  const pending = signals.filter((signal) => {
    return signal.id && signal.result === "pendente" && /^\d+$/.test(String(signal.sourceId || ""));
  }).slice(0, 40);

  if (!pending.length) return signals;

  const updates = new Map();
  for (const signal of pending) {
    try {
      const game = await fetchFixtureState(signal.sourceId, token);
      if (!game) continue;

      const result = getSignalSettlement(signal, game);
      if (!result) {
        updates.set(signal.id, { ...signal, ...game });
        continue;
      }

      const update = {
        result,
        scoreText: game.scoreText,
        liveStatus: game.liveStatus,
        dateText: game.dateText || signal.dateText || "",
        settledAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        updatedAt: now()
      };
      await db.collection("sinais").doc(String(signal.id)).update(update);
      updates.set(signal.id, { ...signal, ...update });
    } catch {
      continue;
    }
  }

  return signals.map((signal) => updates.get(signal.id) || signal);
}

async function listSignals(res) {
  const db = getDb();
  const snapshot = await db.collection("sinais").orderBy("createdAt", "desc").limit(300).get();
  const signals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const settledSignals = await settleSignalsFromApi(db, signals);
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
  const { id, result, scoreText, liveStatus, dateText } = readBody(req);
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
