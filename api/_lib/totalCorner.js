const TOTALCORNER_TODAY_URL = "https://www.totalcorner.com/pt/match/today";

function readerUrl(url) {
  return `https://r.jina.ai/http://${url}`;
}

function asNumber(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTeam(value) {
  return cleanLine(value)
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^\d+\s+/, "")
    .replace(/\s+\d+$/, "")
    .trim();
}

function normalizeTeam(value) {
  return cleanTeam(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|sc|ac|ec|club|de|do|da|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamScore(left, right) {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const aTokens = new Set(a.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(b.split(" ").filter((token) => token.length > 2));
  if (!aTokens.size || !bTokens.size) return 0;
  const hits = [...aTokens].filter((token) => bTokens.has(token)).length;
  return hits / Math.max(aTokens.size, bTokens.size);
}

function isScoreLine(value) {
  return /^\d+\s*-\s*\d+$/.test(cleanLine(value));
}

function parseScorePair(value) {
  const match = cleanLine(value).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return null;
  return { home: asNumber(match[1]), away: asNumber(match[2]) };
}

function parseCornerLine(value) {
  const match = cleanLine(value).match(/^(\d+(?:\.\d+)?)/);
  return match ? asNumber(match[1]) : 0;
}

function parseFirstNumber(value) {
  const match = cleanLine(value).match(/(\d+(?:\.\d+)?)/);
  return match ? asNumber(match[1]) : 0;
}

function parseGoalLine(value) {
  const line = parseFirstNumber(value);
  return line > 0 && line <= 6 ? line : 0;
}

function parseHandicapLine(value) {
  const match = cleanLine(value).match(/([+-]?\d+(?:\.\d+)?)\s*(?:\([^)]+\))?\s*$/);
  return match ? asNumber(match[1]) : null;
}

function stripMarkdownImages(value) {
  return String(value || "").replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
}

function parseBlock(block) {
  const lines = String(block || "").split("\n").map(cleanLine).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /^\d{2}:\d{2}\s+/.test(line));
  if (headerIndex <= 0) return null;

  const header = lines[headerIndex];
  const scoreMatch = header.match(/^(.*?)\s+(\d+)\s*-\s*(\d+)\s+(.*)$/);
  if (!scoreMatch) return null;

  const beforeScore = scoreMatch[1];
  const afterScoreRaw = scoreMatch[4];
  const handicapLine = parseHandicapLine(afterScoreRaw);
  const afterScore = afterScoreRaw.replace(/\s+[+-]?\d+(?:\.\d+)?(?:\s*\([^)]+\))?\s*$/, "");
  const timeMatch = beforeScore.match(/^(\d{2}:\d{2})(?:\s+(\d{1,3}|Intervalo|HT|FT))?\s+(.+)$/i);
  if (!timeMatch) return null;

  const cornerIndex = lines.findIndex((line, index) => index > headerIndex && isScoreLine(line));
  if (cornerIndex < 0) return null;

  const corners = parseScorePair(lines[cornerIndex]);
  if (!corners) return null;

  const cornerLine = parseCornerLine(lines.slice(cornerIndex + 1).find((line) => !/^\(/.test(line) && /^\d/.test(line)));

  return {
    league: lines[headerIndex - 1],
    time: timeMatch[1],
    status: timeMatch[2] || "",
    home: cleanTeam(timeMatch[3]),
    away: cleanTeam(afterScore),
    homeGoals: asNumber(scoreMatch[2]),
    awayGoals: asNumber(scoreMatch[3]),
    homeCorners: corners.home,
    awayCorners: corners.away,
    liveCorners: corners.home + corners.away,
    handicapLine,
    cornerLine,
    source: "TotalCorner"
  };
}

function parseCompactRecord(record) {
  const text = String(record || "").replace(/\s+/g, " ").trim();
  const teamMatches = [
    ...text.matchAll(/\[([^\]]+)\]\(https:\/\/www\.totalcorner\.com\/pt\/team\/view\/[^)]*\)/g)
  ];
  if (teamMatches.length < 2) return null;

  const homeMatch = teamMatches[0];
  const awayMatch = teamMatches[1];
  const homeEnd = homeMatch.index + homeMatch[0].length;
  const awayEnd = awayMatch.index + awayMatch[0].length;
  const beforeHome = stripMarkdownImages(text.slice(0, homeMatch.index)).replace(/\s+/g, " ").trim();
  const betweenTeams = text.slice(homeEnd, awayMatch.index);
  const afterAway = stripMarkdownImages(text.slice(awayEnd))
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const timeMatch = beforeHome.match(/(\d{2}:\d{2})(?:\s+(\d{1,3}|Intervalo|HT|FT))?/i);
  const goalsMatch = betweenTeams.match(/(\d+)\s*-\s*(\d+)/);
  if (!timeMatch || !goalsMatch) return null;

  const handicapMatches = [...afterAway.matchAll(/([+-]\d+(?:\.\d+)?|0\.0)(?:\s*\([^)]+\))?/g)];
  const handicapMatch = handicapMatches[0] || null;
  const handicapLine = handicapMatch ? asNumber(handicapMatch[1]) : null;
  const afterHandicap = handicapMatch
    ? afterAway.slice(handicapMatch.index + handicapMatch[0].length)
    : afterAway;
  const cornersMatch = afterHandicap.match(/(\d+)\s*-\s*(\d+)/);
  if (!cornersMatch) return null;

  const afterCorners = afterHandicap
    .slice(cornersMatch.index + cornersMatch[0].length)
    .replace(/^\s*\([^)]*\)\s*/, "");
  const cornerLineMatch = cleanLine(afterCorners).match(/^(\d+(?:\.\d+)?)(?:\s*\([^)]+\))?/);
  const afterCornerLine = cornerLineMatch ? cleanLine(afterCorners).slice(cornerLineMatch[0].length) : "";

  return {
    league: "TotalCorner",
    time: timeMatch[1],
    status: timeMatch[2] || "",
    home: cleanTeam(homeMatch[1]),
    away: cleanTeam(awayMatch[1]),
    homeGoals: asNumber(goalsMatch[1]),
    awayGoals: asNumber(goalsMatch[2]),
    homeCorners: asNumber(cornersMatch[1]),
    awayCorners: asNumber(cornersMatch[2]),
    liveCorners: asNumber(cornersMatch[1]) + asNumber(cornersMatch[2]),
    handicapLine,
    cornerLine: parseCornerLine(afterCorners),
    goalLine: parseGoalLine(afterCornerLine),
    source: "TotalCorner"
  };
}

function parseCompactRows(markdown) {
  const records = [
    ...String(markdown || "").matchAll(
      /!\[Image\s+\d+[^\]]*\]\(https:\/\/static\.totalcorner\.com\/img\/countries\/[^)]*\)([\s\S]*?)(?=!\[Image\s+\d+[^\]]*\]\(https:\/\/static\.totalcorner\.com\/img\/countries\/|Para usar nossos dados|$)/g
    )
  ];
  return records.map((match) => parseCompactRecord(match[1])).filter((row) => row && row.home && row.away);
}

function getSaoPauloDateText() {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function getSaoPauloDateIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function statusInfo(status) {
  const value = cleanLine(status);
  if (/^\d{1,3}$/.test(value)) return { elapsed: asNumber(value), short: "LIVE", liveStatus: `${value}'` };
  if (/^Intervalo|HT$/i.test(value)) return { elapsed: 45, short: "HT", liveStatus: "HT" };
  if (/^FT$/i.test(value)) return { elapsed: 90, short: "FT", liveStatus: "FT" };
  return { elapsed: 0, short: value ? "LIVE" : "NS", liveStatus: value || "Pre-jogo" };
}

export function totalCornerRowsToFixtures(rows) {
  const today = getSaoPauloDateIso();
  return (rows || []).map((row) => {
    const status = statusInfo(row.status);
    return {
      fixture: {
        id: `totalcorner-${row.league}-${row.home}-${row.away}-${row.time}`,
        date: `${today}T${String(row.time || "00:00").padStart(5, "0")}:00-03:00`,
        status: { elapsed: status.elapsed, short: status.short }
      },
      teams: {
        home: { name: row.home },
        away: { name: row.away }
      },
      league: { name: row.league || "TotalCorner" },
      goals: { home: row.homeGoals || 0, away: row.awayGoals || 0 },
      displayTime: row.time || "--:--",
      liveStatus: status.liveStatus,
      source: "TotalCorner",
      totalCorner: row,
      handicapLine: row.handicapLine,
      handicapSignal: row.handicapLine === null ? "" : `Handicap mandante ${row.handicapLine > 0 ? "+" : ""}${row.handicapLine}`,
      goalLine: row.goalLine || 0,
      totalCornerGoalLine: row.goalLine || 0,
      avgCornersTotal: row.cornerLine || row.liveCorners,
      mediaEscanteiosConjunta: row.cornerLine || row.liveCorners,
      liveStats: [
        { team: { name: row.home }, statistics: [{ type: "Corner Kicks", value: row.homeCorners }] },
        { team: { name: row.away }, statistics: [{ type: "Corner Kicks", value: row.awayCorners }] }
      ],
      totalCornerDateText: getSaoPauloDateText()
    };
  });
}

function parseTotalCornerMarkdownLegacy(markdown) {
  const text = String(markdown || "");
  const footerIndex = text.indexOf("Para usar nossos dados");
  const section = footerIndex > 0 ? text.slice(0, footerIndex) : text;
  return section
    .split(/Estatísticas Cotas Ao vivo/i)
    .map(parseBlock)
    .filter((row) => row && row.home && row.away);
}

export function parseTotalCornerMarkdown(markdown) {
  const text = String(markdown || "");
  const footerIndex = text.indexOf("Para usar nossos dados");
  const section = footerIndex > 0 ? text.slice(0, footerIndex) : text;
  const tableRows = parseTotalCornerMarkdownLegacy(section);
  return tableRows.length ? tableRows : parseCompactRows(section);
}

function findTotalCornerMatch(row, totalCornerRows) {
  let best = null;
  let bestScore = 0;

  for (const candidate of totalCornerRows) {
    const homeScore = teamScore(row.teams?.home?.name, candidate.home);
    const awayScore = teamScore(row.teams?.away?.name, candidate.away);
    const score = (homeScore + awayScore) / 2;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 0.55 ? best : null;
}

export function mergeTotalCornerRows(rows, totalCornerRows) {
  return (rows || []).map((row) => {
    const match = findTotalCornerMatch(row, totalCornerRows || []);
    if (!match) return row;

    return {
      ...row,
      totalCorner: match,
      handicapLine: match.handicapLine,
      handicapSignal: match.handicapLine === null ? "" : `Handicap mandante ${match.handicapLine > 0 ? "+" : ""}${match.handicapLine}`,
      goalLine: match.goalLine || 0,
      totalCornerGoalLine: match.goalLine || 0,
      avgCornersTotal: match.cornerLine || match.liveCorners,
      mediaEscanteiosConjunta: match.cornerLine || match.liveCorners,
      liveStats: [
        { team: row.teams?.home, statistics: [{ type: "Corner Kicks", value: match.homeCorners }] },
        { team: row.teams?.away, statistics: [{ type: "Corner Kicks", value: match.awayCorners }] }
      ]
    };
  });
}

export async function fetchTotalCornerToday() {
  const response = await fetch(readerUrl(TOTALCORNER_TODAY_URL), {
    headers: {
      "User-Agent": "Mozilla/5.0 Analise-Futebol/1.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });

  if (!response.ok) throw new Error(`TotalCorner retornou ${response.status}.`);
  return parseTotalCornerMarkdown(await response.text());
}
