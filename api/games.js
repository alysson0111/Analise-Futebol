import { analyzeFixtures, publicGame } from "./_lib/scanner.js";

const API_BASE = "https://v3.football.api-sports.io/fixtures";
const API_STATISTICS = "https://v3.football.api-sports.io/fixtures/statistics";
const API_ODDS = "https://v3.football.api-sports.io/odds";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

function dateRange(start, end) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    throw new Error("Periodo invalido.");
  }

  const days = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  if (days.length > 31) throw new Error("Use no maximo 31 dias por busca.");
  return days;
}

async function fetchApi(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "x-apisports-key": token }
  });

  if (!response.ok) {
    throw new Error(`API-Football retornou ${response.status}.`);
  }

  return response.json();
}

function getRows(payload) {
  return payload.response || [];
}

async function enrichLive(payload, token) {
  await Promise.all(getRows(payload).map(async (row) => {
    const fixtureId = row.fixture?.id;
    if (!fixtureId) return;

    try {
      const response = await fetch(`${API_STATISTICS}?fixture=${fixtureId}`, {
        headers: { "x-apisports-key": token }
      });
      if (!response.ok) return;
      const stats = await response.json();
      row.liveStats = getRows(stats);
    } catch {
      row.liveStats = [];
    }
  }));
}

async function enrichOdds(payload, token) {
  const rows = getRows(payload).slice(0, 50);
  await Promise.all(rows.map(async (row) => {
    const fixtureId = row.fixture?.id;
    if (!fixtureId) return;

    try {
      const response = await fetch(`${API_ODDS}?fixture=${fixtureId}`, {
        headers: { "x-apisports-key": token }
      });
      if (!response.ok) return;
      const odds = await response.json();
      row.oddsPayload = getRows(odds);
    } catch {
      row.oddsPayload = [];
    }
  }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const token = process.env.API_FOOTBALL_KEY;
    if (!token) throw new Error("API_FOOTBALL_KEY nao configurada na Vercel.");

    const mode = req.query.mode === "live" ? "live" : "period";
    const payloads = [];

    if (mode === "live") {
      const payload = await fetchApi("?live=all", token);
      await enrichLive(payload, token);
      await enrichOdds(payload, token);
      payloads.push(payload);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const start = parseDate(req.query.start) || today;
      const end = parseDate(req.query.end) || start;
      for (const day of dateRange(start, end)) {
        const payload = await fetchApi(`?date=${day}`, token);
        await enrichOdds(payload, token);
        payloads.push(payload);
      }
    }

    const games = payloads.flatMap((payload) => analyzeFixtures(payload)).map(publicGame);
    send(res, 200, {
      updatedAt: new Date().toISOString(),
      count: games.length,
      games
    });
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar jogos." });
  }
}
