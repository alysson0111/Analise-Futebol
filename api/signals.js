import { getDb, now } from "./_lib/firebase.js";
import { analyzeFixtures } from "./_lib/scanner.js";
import { fetchTotalCornerDate, fetchTotalCornerToday, totalCornerRowsToFixtures } from "./_lib/totalCorner.js";
import { isFinishedGame, buildFinalSignalUpdate } from "../src/analysis/signalSettlement.js";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);
const SIGNALS_READ_LIMIT = 2000;

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
  const mlPick = String(analysis.mlPick || input.mlPick || "");
  const mlPickLabel = String(analysis.mlPickLabel || input.mlPickLabel || mlLabelFromPick(mlPick, input) || "");
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
    mlPick,
    mlPickLabel,
    handicapLine: Number.isFinite(Number(input.handicapLine)) ? Number(input.handicapLine) : extractHandicapLine(input),
    odd: Number(analysis.odd || input.odd || 0),
    oddSource: String(input.oddSource || ""),
    oddTicker: String(input.oddTicker || ""),
    oddSide: String(input.oddSide || ""),
    oddFetchedAt: String(input.oddFetchedAt || ""),
    confidence: Number(analysis.confianca || input.confidence || 0),
    scoreText: String(input.scoreText || ""),
    entryScoreText: String(input.scoreText || ""),
    entryLiveStatus: String(input.liveStatus || ""),
    entryLiveCorners: Number.isFinite(liveCorners) ? liveCorners : null,
    settlementPolicy: "final-only",
    liveStatus: String(input.liveStatus || ""),
    dateText: String(input.dateText || ""),
    stats: stats.map(String).filter(Boolean).slice(0, 20),
    signalLines: normalizedSignalLines.slice(0, 10),
    liveCorners: Number.isFinite(liveCorners) ? liveCorners : null,
    result: "pendente",
    createdAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  };
}

function mlLabelFromPick(pick, game) {
  if (pick === "home") return `Casa (${game.home || "mandante"})`;
  if (pick === "away") return `Fora (${game.away || "visitante"})`;
  if (pick === "draw") return "Empate";
  return "";
}

function normalizeMarketName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function extractHandicapLine(value) {
  if (Number.isFinite(Number(value?.handicapLine))) return Number(value.handicapLine);
  const text = [
    ...(Array.isArray(value?.signalLines) ? value.signalLines : []),
    ...(Array.isArray(value?.signals) ? value.signals : []),
    ...(Array.isArray(value?.stats) ? value.stats : [])
  ].join(" ");
  const match = text.match(/Handicap[^+-]*([+-]\d+(?:\.\d+)?|0\.0)/i);
  return match ? asNumber(match[1], NaN) : NaN;
}

function parseScoreTotal(scoreText) {
  const parts = String(scoreText || "").split("x").map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] : 0;
}

function elapsedFromStatus(value) {
  const match = String(value || "").match(/\d{1,3}/);
  return match ? asNumber(match[0]) : 0;
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

function ptDateToIso(dateText) {
  const match = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function uniqueRows(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = `${row.dateIso || ""}|${row.league || ""}|${row.home || ""}|${row.away || ""}|${row.time || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldFetchDatedResult(signal) {
  const liveStatus = String(signal.liveStatus || "").toUpperCase();
  if (!signal.dateText) return false;
  if (FINISHED_STATUSES.has(liveStatus)) return true;

  const elapsed = elapsedFromStatus(liveStatus);
  const createdSeconds = Number(signal.createdAt?._seconds || 0);
  const olderThanOneHour = createdSeconds > 0 && Date.now() - createdSeconds * 1000 > 60 * 60 * 1000;
  return elapsed >= 45 || olderThanOneHour;
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
  games = games.filter((game) => game.dateText === signal.dateText);
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

async function settleSignalsFromTotalCorner(db, signals) {
  const pending = signals.filter((signal) => signal.id && !signal.finalConfirmed && (signal.result === "pendente" || !isFinishedGame(signal)));
  if (!pending.length) return signals;

  const updates = new Map();
  let games = [];
  try {
    const dateIsos = [...new Set(
      pending
        .filter(shouldFetchDatedResult)
        .map((signal) => ptDateToIso(signal.dateText))
        .filter(Boolean)
    )].slice(0, 2);
    const rowResults = await Promise.allSettled([
      fetchTotalCornerToday(),
      ...dateIsos.map((dateIso) => fetchTotalCornerDate(dateIso))
    ]);
    const totalCornerRows = rowResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    games = analyzeFixtures({ response: totalCornerRowsToFixtures(uniqueRows(totalCornerRows)) });
  } catch {
    return signals;
  }

  for (const signal of pending) {
    const game = findCurrentGame(signal, games);
    if (!game) continue;
    const currentUpdate = buildFinalSignalUpdate(signal, game);
    if (!currentUpdate) continue;

    const settlement = {
      ...currentUpdate,
      settledAtText: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      updatedAt: now()
    };
    updates.set(signal.id, settlement);
    await db.collection("sinais").doc(signal.id).update(settlement);
  }

  return signals.map((signal) => updates.has(signal.id) ? { ...signal, ...updates.get(signal.id) } : signal);
}

async function listSignals(res) {
  const db = getDb();
  const snapshot = await db.collection("sinais").orderBy("createdAt", "desc").limit(SIGNALS_READ_LIMIT).get();
  const signals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const settledSignals = await settleSignalsFromTotalCorner(db, signals);
  send(res, 200, { signals: settledSignals, limit: SIGNALS_READ_LIMIT });
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
    return send(res, 200, { id: doc.id, ...previous, duplicate: true });
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
  const { id, result, scoreText, liveStatus, liveCorners } = readBody(req);
  if (!id || !["green", "push", "red", "pendente"].includes(result)) {
    return send(res, 400, { error: "Resultado invalido." });
  }

  const doc = db.collection("sinais").doc(String(id));
  const snapshot = await doc.get();
  if (!snapshot.exists) return send(res, 404, { error: "Sinal nao encontrado." });
  const signal = snapshot.data();
  let finalUpdate;
  if (scoreText && isFinishedGame({ liveStatus })) {
    finalUpdate = buildFinalSignalUpdate(signal, { scoreText, liveStatus, liveCorners });
    if (!finalUpdate || finalUpdate.result !== result) return send(res, 400, { error: "Resultado nao corresponde ao sinal salvo." });
  } else if (!signal.finalConfirmed && !isFinishedGame(signal)) {
    return send(res, 409, { error: "O sinal aguarda a confirmacao de fim do jogo." });
  }
  const update = {
    ...(finalUpdate || { result, settlementFactor: result === "push" ? 0 : 1 }),
    settledAtText: result === "pendente" ? "" : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    updatedAt: now()
  };
  await doc.update(update);

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
