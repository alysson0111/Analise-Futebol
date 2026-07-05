import { getDb, now } from "./_lib/firebase.js";
import { analyzeFixtures } from "./_lib/scanner.js";
import { fetchTotalCornerToday, totalCornerRowsToFixtures } from "./_lib/totalCorner.js";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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
    ? ["Over 9.5 escanteios"]
    : [...new Set(signalLines)];
  const liveCorners = Number(input.liveCorners);

  return {
    key: String(input.key || ""),
    sourceId: String(input.sourceId || ""),
    source: String(input.source || ""),
    forebetUrl: String(input.forebetUrl || ""),
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

function elapsedFromStatus(value) {
  const match = String(value || "").match(/\d{1,3}/);
  return match ? asNumber(match[0]) : 0;
}

function isFinishedGame(game) {
  if (game.forceFinished) return true;
  const status = String(game.apiStatus || game.fixture?.status?.short || "").toUpperCase();
  const elapsed = asNumber(game.fixture?.status?.elapsed || game.elapsed || elapsedFromStatus(game.liveStatus));
  return FINISHED_STATUSES.has(status) || elapsed >= 90;
}

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function forebetReaderUrl(url) {
  return `https://r.jina.ai/http://${url}`;
}

function forebetMatchUrl(signal) {
  if (signal.forebetUrl) return signal.forebetUrl;
  const sourceId = String(signal.sourceId || "");
  if (!/^\d+$/.test(sourceId)) return "";
  const slug = slugify(`${signal.home || ""} ${signal.away || ""}`);
  return slug ? `https://www.forebet.com/en/football/matches/${slug}-${sourceId}` : "";
}

function parsePtDateTime(dateText, stats = []) {
  const dateMatch = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!dateMatch) return null;
  const timeLine = (Array.isArray(stats) ? stats : []).find((entry) => /DADO \| Horario \|/i.test(String(entry)));
  const timeMatch = String(timeLine || "").match(/(\d{1,2}):(\d{2})/);
  const [, day, month, year] = dateMatch;
  const hour = timeMatch ? timeMatch[1].padStart(2, "0") : "00";
  const minute = timeMatch ? timeMatch[2] : "00";
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shouldCheckForebetSettlement(signal) {
  if (!forebetMatchUrl(signal)) return false;
  const liveStatus = String(signal.liveStatus || "").toUpperCase().replace("'", "");
  const alreadyFinal = FINISHED_STATUSES.has(liveStatus);
  if (signal.result !== "pendente" && alreadyFinal) return false;
  const hasPartialScore = /^\d{1,3}$/.test(liveStatus);
  const checkedSeconds = Number(signal.settleCheckedAt?._seconds || 0);
  if (!hasPartialScore && checkedSeconds && Date.now() - checkedSeconds * 1000 < 2 * 60 * 60 * 1000) return false;

  const kickoff = parsePtDateTime(signal.dateText, signal.stats);
  if (!kickoff) return true;

  const nowMs = Date.now();
  const settleWindowMs = 120 * 60 * 1000;
  return kickoff.getTime() + settleWindowMs <= nowMs;
}

function parseForebetMatchScore(markdown) {
  const text = String(markdown || "");
  const scoreMatch = text.match(/\*\*(\d+)\s*-\s*(\d+)\*\*\s*(FT|AET|PEN)/i)
    || text.match(/(FT|AET|PEN)\s*\n+\s*\*\*(\d+)\s*-\s*(\d+)\*\*/i)
    || text.match(/\*\*(\d+)\s*-\s*(\d+)\*\*\s*(HT|\d{1,3}'?)/i)
    || text.match(/(HT|\d{1,3}'?)\s*\n+\s*\*\*(\d+)\s*-\s*(\d+)\*\*/i);
  if (!scoreMatch) return null;

  const scoreFirst = scoreMatch[0].trim().startsWith("**");
  const homeGoals = asNumber(scoreFirst ? scoreMatch[1] : scoreMatch[2]);
  const awayGoals = asNumber(scoreFirst ? scoreMatch[2] : scoreMatch[3]);
  const status = String(scoreFirst ? scoreMatch[3] : scoreMatch[1]).toUpperCase().replace("'", "");
  const elapsed = /^\d+$/.test(status) ? asNumber(status) : (status === "HT" ? 45 : FINISHED_STATUSES.has(status) ? 90 : 0);

  return {
    scoreText: `${homeGoals}x${awayGoals}`,
    totalGoals: homeGoals + awayGoals,
    apiStatus: status,
    liveStatus: /^\d+$/.test(status) ? `${status}'` : status,
    fixture: { status: { short: status, elapsed } },
    goals: { home: homeGoals, away: awayGoals }
  };
}

function getSignalSettlement(signal, game) {
  const market = normalizeMarketName(signal.market || signal.marketLabel);
  const totalGoals = Number.isFinite(Number(game.totalGoals)) ? Number(game.totalGoals) : parseScoreTotal(game.scoreText);
  const finished = isFinishedGame(game);
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

  if (market.includes("under35") || market.includes("under3.5")) {
    if (totalGoals >= 4) return "red";
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

function normalizeTeam(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatchScore(a, b) {
  const left = normalizeTeam(a);
  const right = normalizeTeam(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const hits = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return hits / Math.max(leftTokens.size, rightTokens.size);
}

function findCurrentGame(signal, games) {
  const sameSource = games.filter((game) => game.sourceId === signal.sourceId);
  const sourceMatch = sameSource.find((game) => game.market === signal.market) || sameSource[0];
  if (sourceMatch) return sourceMatch;

  let best = null;
  let bestScore = 0;
  for (const game of games) {
    if (game.market !== signal.market) continue;
    const score = (teamMatchScore(signal.home, game.home) + teamMatchScore(signal.away, game.away)) / 2;
    if (score > bestScore) {
      best = game;
      bestScore = score;
    }
  }
  return bestScore >= 0.65 ? best : null;
}

function currentGameUpdate(signal, game, result) {
  return {
    result: result || signal.result || "pendente",
    scoreText: game.scoreText || signal.scoreText || "",
    liveStatus: game.liveStatus || signal.liveStatus || "",
    dateText: game.dateText || signal.dateText || "",
    mlPick: game.mlPick || signal.mlPick || "",
    mlPickLabel: game.mlPickLabel || signal.mlPickLabel || "",
    liveCorners: Number.isFinite(Number(game.liveCorners)) ? Number(game.liveCorners) : signal.liveCorners,
    signalLines: Array.isArray(game.generatedSignals) && game.generatedSignals.length ? game.generatedSignals : signal.signalLines || []
  };
}

function shouldPersistCurrentUpdate(signal, update) {
  return update.result !== signal.result
    || String(update.scoreText || "") !== String(signal.scoreText || "")
    || String(update.liveStatus || "") !== String(signal.liveStatus || "")
    || String(update.dateText || "") !== String(signal.dateText || "")
    || String(update.mlPick || "") !== String(signal.mlPick || "")
    || String(update.mlPickLabel || "") !== String(signal.mlPickLabel || "")
    || Number(update.liveCorners ?? -1) !== Number(signal.liveCorners ?? -1)
    || JSON.stringify(update.signalLines || []) !== JSON.stringify(signal.signalLines || []);
}

async function settleSignalsFromTotalCorner(db, signals) {
  const pending = signals.filter((signal) => signal.id && signal.result === "pendente");
  if (!pending.length) return signals;

  const updates = new Map();
  for (const signal of pending) {
    const createdSeconds = Number(signal.createdAt?._seconds || 0);
    const oldEnough = createdSeconds > 0 && Date.now() - createdSeconds * 1000 > 3 * 60 * 60 * 1000;
    const liveStatus = String(signal.liveStatus || "").toUpperCase();
    const canExpire = oldEnough && liveStatus !== "NS" && Boolean(signal.scoreText);
    const storedResult = getSignalSettlement(signal, { ...signal, forceFinished: canExpire });
    if (!storedResult) continue;
    const settlement = {
      result: storedResult,
      scoreText: signal.scoreText || "",
      liveStatus: signal.liveStatus || "",
      dateText: signal.dateText || "",
      liveCorners: Number.isFinite(Number(signal.liveCorners)) ? Number(signal.liveCorners) : null,
      signalLines: signal.signalLines || [],
      settledAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      updatedAt: now()
    };
    updates.set(signal.id, settlement);
    await db.collection("sinais").doc(signal.id).update(settlement);
  }

  const remaining = pending.filter((signal) => !updates.has(signal.id));
  if (!remaining.length) {
    return signals.map((signal) => updates.has(signal.id) ? { ...signal, ...updates.get(signal.id) } : signal);
  }

  let games = [];
  try {
    const totalCornerRows = await fetchTotalCornerToday();
    games = analyzeFixtures({ response: totalCornerRowsToFixtures(totalCornerRows) });
  } catch {
    return signals.map((signal) => updates.has(signal.id) ? { ...signal, ...updates.get(signal.id) } : signal);
  }

  for (const signal of remaining) {
    const game = findCurrentGame(signal, games);
    if (!game) continue;
    const result = getSignalSettlement(signal, game);
    const currentUpdate = currentGameUpdate(signal, game, result);
    if (!shouldPersistCurrentUpdate(signal, currentUpdate)) continue;

    const settlement = {
      ...currentUpdate,
      settledAtText: result ? new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : signal.settledAtText || "",
      updatedAt: now()
    };
    updates.set(signal.id, settlement);
    await db.collection("sinais").doc(signal.id).update(settlement);
  }

  return signals.map((signal) => updates.has(signal.id) ? { ...signal, ...updates.get(signal.id) } : signal);
}

async function listSignals(res) {
  const db = getDb();
  const snapshot = await db.collection("sinais").orderBy("createdAt", "desc").limit(300).get();
  const signals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const settledSignals = await settleSignalsFromTotalCorner(db, signals);
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
