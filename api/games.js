import { fetchForebetLiveGames } from "./_lib/forebetLive.js";
import { fetchForebetPredictions } from "./forebet-analysis.js";

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
  while (current <= endDate && days.length < 7) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
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

function extractSourceId(url, fallback) {
  const match = String(url || "").match(/-(\d+)(?:\?|$)/);
  return match ? match[1] : fallback;
}

function splitTeams(teamText) {
  const words = String(teamText || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { home: teamText || "Mandante", away: "Visitante" };
  const splitAt = Math.max(1, Math.floor(words.length / 2));
  return {
    home: words.slice(0, splitAt).join(" "),
    away: words.slice(splitAt).join(" ")
  };
}

function dateTextFromKickoff(kickoffText, fallbackDate) {
  const match = String(kickoffText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) {
    const [, year, month, day] = String(fallbackDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
    return year ? `${day}/${month}/${year}` : "";
  }
  const [, day, month, year] = match;
  return `${day}/${month}/${year}`;
}

function timeFromKickoff(kickoffText) {
  return String(kickoffText || "").match(/(\d{2}:\d{2})/)?.[1] || "--:--";
}

function confidenceFromGoals(prediction) {
  const overProb = Number(prediction.overProb || 0);
  const avgGoals = Number(prediction.avgGoals || 0);
  return Math.max(62, Math.min(92, Math.round(56 + overProb * 0.28 + Math.max(0, avgGoals - 2.5) * 8)));
}

function confidenceFromCorners(prediction) {
  const overProb = Number(prediction.overProb || 0);
  const avgCorners = Number(prediction.avgCorners || 0);
  return Math.max(62, Math.min(92, Math.round(54 + overProb * 0.32 + Math.max(0, avgCorners - 9.5) * 5)));
}

function winnerFromScore(score) {
  const [home, away] = String(score || "").split("-").map((part) => Number(part.trim()));
  if (!Number.isFinite(home) || !Number.isFinite(away)) return "";
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function mlLabel(pick, game) {
  if (pick === "home") return `Casa (${game.home})`;
  if (pick === "away") return `Fora (${game.away})`;
  if (pick === "draw") return "Empate";
  return "-";
}

function goalsMarket(prediction) {
  if (prediction.side === "Under") return "under25";
  const avgGoals = Number(prediction.avgGoals || 0);
  if (avgGoals >= 2.8) return "over25";
  if (avgGoals >= 1.8) return "over15";
  return "over05";
}

function marketLabel(market) {
  return {
    over05: "+0.5 gols",
    over15: "+1.5 gols",
    over25: "+2.5 gols",
    under25: "Under 2.5",
    corners: "Escanteios",
    ml: "ML"
  }[market] || market;
}

function baseGame(prediction, market, date) {
  const { home, away } = splitTeams(prediction.teamsText);
  const sourceId = extractSourceId(prediction.url, `${home}-${away}-${prediction.kickoffText}-${market}`);
  return {
    key: `${sourceId}-${market}`,
    sourceId,
    home,
    away,
    league: "Forebet",
    time: timeFromKickoff(prediction.kickoffText),
    dateText: dateTextFromKickoff(prediction.kickoffText, date),
    liveStatus: "Pre-jogo",
    apiStatus: "NS",
    scoreText: "0x0",
    totalGoals: 0,
    liveCorners: null,
    liveShots: 0,
    liveShotsOnTarget: 0,
    source: "Forebet",
    market,
    marketLabel: marketLabel(market),
    odd: 0,
    status: "Entrada",
    grade: "",
    signals: [],
    dadosJogo: [
      "DADO | Fonte | Forebet",
      `DADO | Horario | ${timeFromKickoff(prediction.kickoffText)}`
    ]
  };
}

function goalGame(prediction, date) {
  const market = goalsMarket(prediction);
  const game = baseGame(prediction, market, date);
  return {
    ...game,
    confidence: confidenceFromGoals(prediction),
    stats: [
      `FOREBET | Mercado | ${marketLabel(market)}`,
      `FOREBET | Previsao | ${prediction.side} ${Number(prediction.line || 2.5).toFixed(2)}`,
      `FOREBET | Placar previsto | ${prediction.correctScore}`,
      `FOREBET | Media de gols | ${Number(prediction.avgGoals || 0).toFixed(2)}`
    ]
  };
}

function mlGame(prediction, date) {
  const game = baseGame(prediction, "ml", date);
  const pick = winnerFromScore(prediction.correctScore);
  const confidence = Math.max(60, Math.min(88, Math.round(68 + Math.max(0, Number(prediction.avgGoals || 0) - 2) * 5)));
  return {
    ...game,
    confidence,
    mlPick: pick,
    mlPickLabel: mlLabel(pick, game),
    signals: pick ? [`ML ${mlLabel(pick, game)}`] : [],
    stats: [
      "FOREBET | Mercado | ML",
      `FOREBET | Vencedor previsto | ${mlLabel(pick, game)}`,
      `FOREBET | Placar previsto | ${prediction.correctScore}`,
      `FOREBET | Base media gols | ${Number(prediction.avgGoals || 0).toFixed(2)}`
    ]
  };
}

function cornerGame(prediction, date) {
  const game = baseGame(prediction, "corners", date);
  return {
    ...game,
    confidence: confidenceFromCorners(prediction),
    signals: ["Over 8.5 escanteios", "Over 9.5 escanteios", "Over 10.5 escanteios"],
    stats: [
      "FOREBET | Mercado | Escanteios",
      `FOREBET | Previsao | ${prediction.side} 9.5 cantos`,
      `FOREBET | Cantos previstos | ${prediction.cornerPrediction}`,
      `FOREBET | Media de cantos | ${Number(prediction.avgCorners || 0).toFixed(2)}`
    ]
  };
}

async function fetchForebetPeriodGames(start, end) {
  const days = dateRange(start, end);
  const settled = await Promise.allSettled(days.flatMap((date) => [
    fetchForebetPredictions(date, "goals"),
    fetchForebetPredictions(date, "corners")
  ]));
  const predictions = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
  const games = [];

  for (const prediction of predictions) {
    if (prediction.type === "corners") {
      if (prediction.side === "Over") games.push(cornerGame(prediction, prediction.date));
      continue;
    }

    games.push(goalGame(prediction, prediction.date));
    games.push(mlGame(prediction, prediction.date));
  }

  return {
    updatedAt: new Date().toISOString(),
    count: new Set(games.map((game) => game.sourceId)).size,
    marketRows: games.length,
    source: "Forebet",
    games
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const mode = req.query.mode === "live" ? "live" : "period";
    if (mode === "live") return send(res, 200, await fetchForebetLiveGames());

    const today = getSaoPauloDate();
    const start = parseDate(req.query.start) || today;
    const end = parseDate(req.query.end) || start;
    return send(res, 200, await fetchForebetPeriodGames(start, end));
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar Forebet." });
  }
}
