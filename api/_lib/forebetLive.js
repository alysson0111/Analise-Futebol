import { analyzeFixtures, publicGame } from "./scanner.js";

const FOREBET_LIVE_URL = "https://www.forebet.com/en/live-football-tips";
const FOREBET_READER_URL = `https://r.jina.ai/http://r.jina.ai/http://${FOREBET_LIVE_URL}`;

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSaoPauloDateText() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function parseAmericanDate(dateText, timeText) {
  const match = String(dateText || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return new Date();

  const [, month, day, year] = match;
  const timeMatch = String(timeText || "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  let hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const suffix = timeMatch ? timeMatch[3].toUpperCase() : "AM";
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;

  return new Date(`${year}-${month}-${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
}

function splitTeams(teamText) {
  const words = cleanLine(teamText).split(" ").filter(Boolean);
  if (words.length <= 1) return { home: cleanLine(teamText) || "Mandante", away: "Visitante" };

  const splitAt = Math.max(1, Math.floor(words.length / 2));
  return {
    home: words.slice(0, splitAt).join(" "),
    away: words.slice(splitAt).join(" ")
  };
}

function extractLeague(beforeMatch) {
  const matches = [...String(beforeMatch || "").matchAll(/!\[Image[^\]]*\]\([^)]*\)\s*([A-Za-z0-9]+)/g)];
  return matches.at(-1)?.[1] || "Forebet Live";
}

function extractSourceId(url, fallback) {
  const match = String(url || "").match(/-(\d+)(?:\?|$)/);
  return match ? match[1] : fallback;
}

function extractScore(chunk) {
  const scoreMatch = String(chunk || "").match(/\*{0,2}(\d+)\s*-\s*(\d+)\*{0,2}(?:\s*\((\d+)\s*-\s*(\d+)\))?/);
  const homeGoals = asNumber(scoreMatch?.[1]);
  const awayGoals = asNumber(scoreMatch?.[2]);
  return {
    homeGoals,
    awayGoals,
    scoreText: scoreMatch ? `${homeGoals}x${awayGoals}` : "0x0"
  };
}

function extractStatus(chunk) {
  const lines = String(chunk || "").split("\n").map(cleanLine).filter(Boolean);
  const scoreIndex = lines.findIndex((line) => /^\d+\s*-\s*\d+/.test(line));
  const searchLines = scoreIndex > 0 ? lines.slice(0, scoreIndex).reverse() : lines.slice().reverse();
  const status = searchLines.find((line) => /^(HT|FT|Live Pen\.|\+?\d{1,3}'?|\d{1,3})$/i.test(line));
  if (!status) return { elapsed: 0, apiStatus: "LIVE", liveStatus: "Live" };
  if (/^HT$/i.test(status)) return { elapsed: 45, apiStatus: "HT", liveStatus: "HT" };
  if (/^FT$/i.test(status)) return { elapsed: 90, apiStatus: "FT", liveStatus: "FT" };
  if (/Live Pen\./i.test(status)) return { elapsed: 90, apiStatus: "PEN", liveStatus: "Penaltis" };

  const elapsed = asNumber(status.replace(/[^0-9]/g, ""));
  return { elapsed, apiStatus: "LIVE", liveStatus: elapsed ? `${elapsed}'` : "Live" };
}

function extractPrediction(chunk) {
  const lines = String(chunk || "").split("\n").map(cleanLine).filter(Boolean);
  const probIndex = lines.findIndex((line) => /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(line));
  const probabilities = probIndex >= 0 ? lines[probIndex].split(/\s+/).map(Number) : [0, 0, 0];
  const prediction = probIndex >= 0 ? lines[probIndex + 1] || "" : "";
  const avgGoals = probIndex >= 0 ? asNumber(lines[probIndex + 2]) : 0;

  return {
    probabilities,
    prediction: ["1", "X", "2"].includes(prediction) ? prediction : "",
    avgGoals
  };
}

function parseLiveMarkdown(markdown) {
  const sectionStart = markdown.indexOf("# Live football predictions");
  const section = sectionStart >= 0 ? markdown.slice(sectionStart) : markdown;
  const matchPattern = /\[([^\]\n]+?\s+\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s+[AP]M)\]\((https:\/\/www\.forebet\.com\/en\/football\/matches\/[^)]+)\)/gi;
  const matches = [...section.matchAll(matchPattern)];

  return matches.map((match, index) => {
    const [, title, url] = match;
    const next = matches[index + 1];
    const before = section.slice(Math.max(0, match.index - 180), match.index);
    const chunk = section.slice(match.index + match[0].length, next ? next.index : section.length);
    const titleMatch = title.match(/^(.*?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2}\s+[AP]M)$/i);
    const teamsText = titleMatch?.[1] || title;
    const dateText = titleMatch?.[2] || "";
    const timeText = titleMatch?.[3] || "";
    const kickoff = parseAmericanDate(dateText, timeText);
    const { home, away } = splitTeams(teamsText);
    const { homeGoals, awayGoals, scoreText } = extractScore(chunk);
    const { elapsed, apiStatus, liveStatus } = extractStatus(chunk);
    const { probabilities, prediction, avgGoals } = extractPrediction(chunk);
    const sourceId = extractSourceId(url, `${home}-${away}-${dateText}-${timeText}`);

    return {
      fixture: {
        id: sourceId,
        date: kickoff.toISOString(),
        status: { elapsed, short: apiStatus }
      },
      teams: {
        home: { name: home },
        away: { name: away }
      },
      league: { name: extractLeague(before) },
      goals: { home: homeGoals, away: awayGoals },
      avgGoalsTotal: avgGoals || homeGoals + awayGoals,
      avgGoalsBothTeams: avgGoals || homeGoals + awayGoals,
      bttsPercent: Math.round(Math.min(100, Math.max(0, (probabilities[1] || 0) + (avgGoals || 0) * 8))),
      over25Percent: Math.round(Math.min(100, Math.max(0, (avgGoals || 0) * 24))),
      forebetPrediction: prediction,
      forebetProbabilities: probabilities,
      forebetAvgGoals: avgGoals,
      forebetUrl: url,
      liveStatus,
      source: "Forebet Live"
    };
  });
}

function addForebetStats(game, source) {
  const stats = [
    `FOREBET | Fonte | Ao vivo`,
    `FOREBET | Previsao 1X2 | ${source?.forebetPrediction || "-"}`,
    `FOREBET | Probabilidades 1/X/2 | ${(source?.forebetProbabilities || []).join("/") || "-"}`,
    `FOREBET | Media de gols | ${Number(source?.forebetAvgGoals || 0).toFixed(2)}`
  ];

  return {
    ...game,
    dadosJogo: [
      `DADO | Gols no jogo | ${game.totalGoals}`,
      `DADO | Tempo/status | ${game.liveStatus || "-"}`,
      `DADO | Fonte ao vivo | Forebet`
    ],
    stats: [...stats, ...(game.stats || []).filter((entry) => !String(entry).includes("API nao trouxe"))]
  };
}

export async function fetchForebetLiveGames() {
  const response = await fetch(FOREBET_READER_URL, {
    headers: { "User-Agent": "Mozilla/5.0 Analise-Futebol/1.0" }
  });

  if (!response.ok) throw new Error(`Forebet retornou ${response.status}.`);
  const markdown = await response.text();
  const rows = parseLiveMarkdown(markdown);
  const games = analyzeFixtures({ response: rows }).map((game) => {
    const source = rows.find((row) => String(row.fixture.id) === String(game.sourceId));
    return addForebetStats(publicGame({
      ...game,
      liveStatus: source?.liveStatus || game.liveStatus
    }), source);
  });

  return {
    updatedAt: new Date().toISOString(),
    count: rows.length,
    marketRows: games.length,
    source: "Forebet Live",
    games,
    dateText: getSaoPauloDateText()
  };
}
