const FOREBET_TODAY_URL = "https://www.forebet.com/en/football-tips-and-predictions-for-today/predictions-under-over-goals";
const FOREBET_DATE_URL = "https://www.forebet.com/en/football-predictions/under-over-25-goals";

const MARKET_LABELS = {
  over05: "+0.5 gols",
  over15: "+1.5 gols",
  over25: "+2.5 gols"
};

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

function parseDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "";
}

function getSaoPauloDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateRange(start, end) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end || start}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return [start];

  const days = [];
  const current = new Date(startDate);
  while (current <= endDate && days.length < 7) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function forebetReaderUrl(date) {
  const today = getSaoPauloDate();
  const sourceUrl = date === today ? FOREBET_TODAY_URL : `${FOREBET_DATE_URL}/${date}`;
  return `https://r.jina.ai/http://r.jina.ai/http://${sourceUrl}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function meaningfulTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !["club", "city", "team", "united", "football", "de"].includes(token));
}

function tokenScore(team, target) {
  const tokens = meaningfulTokens(team);
  if (!tokens.length) return 0;
  const hits = tokens.filter((token) => target.includes(token)).length;
  return hits / tokens.length;
}

function marketFromForebet(prediction) {
  const avgGoals = Number(prediction.avgGoals || prediction.line || 0);
  const scoreGoals = String(prediction.correctScore || "")
    .split("-")
    .reduce((sum, part) => sum + Number(part.trim() || 0), 0);
  const total = Math.max(avgGoals, scoreGoals);

  if (total >= 2.8) return "over25";
  if (total >= 1.8) return "over15";
  return "over05";
}

function confidenceFromPrediction(prediction) {
  const overProb = Number(prediction.overProb || 0);
  const avgGoals = Number(prediction.avgGoals || 0);
  return Math.max(62, Math.min(92, Math.round(56 + overProb * 0.28 + Math.max(0, avgGoals - 2.5) * 8)));
}

function parseForebet(markdown) {
  const items = [];
  const rowPattern = /\[([^\]\n]+?)\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\]\((https:\/\/www\.forebet\.com\/en\/football\/matches\/[^)]+)\)\s*\n+\s*(\d{1,3})\s+(\d{1,3})\s*\n+\s*(Over|Under)\s+(\d+(?:\.\d+)?)\s*\n+\s*([0-9]\s*-\s*[0-9])\s*\n+\s*(\d+(?:\.\d+)?)/gi;

  let match = rowPattern.exec(markdown);
  while (match) {
    const [, teamsText, kickoffText, url, underProb, overProb, side, line, correctScore, avgGoals] = match;
    items.push({
      teamsText: teamsText.trim(),
      kickoffText,
      url,
      side,
      line: Number(line),
      underProb: Number(underProb),
      overProb: Number(overProb),
      correctScore: correctScore.replace(/\s+/g, ""),
      avgGoals: Number(avgGoals),
      normalized: normalizeText(`${teamsText} ${url}`)
    });
    match = rowPattern.exec(markdown);
  }

  return items;
}

async function fetchForebetPredictions(date) {
  const response = await fetch(forebetReaderUrl(date), {
    headers: {
      "User-Agent": "Mozilla/5.0 Analise-Futebol/1.0"
    }
  });

  if (!response.ok) throw new Error(`Forebet retornou ${response.status}.`);
  const markdown = await response.text();
  const predictions = parseForebet(markdown);
  if (!predictions.length) throw new Error("Forebet nao retornou previsoes legiveis.");
  return predictions.map((prediction) => ({ ...prediction, date }));
}

function findPrediction(game, predictions) {
  const home = normalizeText(game.home);
  const away = normalizeText(game.away);

  let best = null;
  for (const prediction of predictions) {
    const target = prediction.normalized;
    const direct = target.includes(home) && target.includes(away);
    const score = tokenScore(game.home, target) + tokenScore(game.away, target);
    if (direct || score >= 1.3) {
      if (!best || score > best.score) best = { prediction, score };
    }
  }

  return best?.prediction || null;
}

function applyForebet(games, predictions) {
  const picks = new Map();
  const pickedSources = new Set();

  for (const game of games || []) {
    const sourceId = String(game.sourceId || "");
    if (!sourceId || pickedSources.has(sourceId)) continue;

    const prediction = findPrediction(game, predictions);
    if (!prediction || prediction.side !== "Over") continue;

    const market = marketFromForebet(prediction);
    picks.set(sourceId, { market, prediction });
    pickedSources.add(sourceId);
  }

  const analyzedGames = (games || []).map((game) => {
    const pick = picks.get(String(game.sourceId || ""));
    if (!pick) return game;

    if (game.market !== pick.market) {
      return {
        ...game,
        confidence: 0,
        status: "Observar",
        stats: [`FOREBET | Melhor mercado over | ${MARKET_LABELS[pick.market]}`]
      };
    }

    const { prediction } = pick;
    return {
      ...game,
      marketLabel: MARKET_LABELS[pick.market],
      confidence: confidenceFromPrediction(prediction),
      status: "Entrada",
      odd: game.odd || 0,
      stats: [
        `FOREBET | Mercado | ${MARKET_LABELS[pick.market]}`,
        `FOREBET | Previsao | ${prediction.side} ${prediction.line.toFixed(2)}`,
        `FOREBET | Placar previsto | ${prediction.correctScore}`,
        `FOREBET | Media de gols | ${prediction.avgGoals.toFixed(2)}`
      ]
    };
  });

  return { analyzedGames, picksCount: picks.size };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const body = readBody(req);
    const games = Array.isArray(body.games) ? body.games : [];
    const start = parseDate(body.start) || getSaoPauloDate();
    const end = parseDate(body.end) || start;
    const settled = await Promise.allSettled(dateRange(start, end).map(fetchForebetPredictions));
    const predictions = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
    if (!predictions.length) {
      const reason = settled.find((entry) => entry.status === "rejected")?.reason?.message;
      throw new Error(reason || "Forebet nao retornou previsoes legiveis.");
    }
    const { analyzedGames, picksCount } = applyForebet(games, predictions);

    send(res, 200, {
      games: analyzedGames,
      forebetCount: picksCount,
      sourceCount: predictions.length,
      source: "Forebet",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar Forebet." });
  }
}
