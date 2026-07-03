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

function parseHandicapLine(value) {
  const match = cleanLine(value).match(/([+-]?\d+(?:\.\d+)?)\s*(?:\([^)]+\))?\s*$/);
  return match ? asNumber(match[1]) : null;
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
    homeCorners: corners.home,
    awayCorners: corners.away,
    liveCorners: corners.home + corners.away,
    handicapLine,
    cornerLine,
    source: "TotalCorner"
  };
}

export function parseTotalCornerMarkdown(markdown) {
  const text = String(markdown || "");
  const footerIndex = text.indexOf("Para usar nossos dados");
  const section = footerIndex > 0 ? text.slice(0, footerIndex) : text;
  return section
    .split(/Estatísticas Cotas Ao vivo/i)
    .map(parseBlock)
    .filter((row) => row && row.home && row.away);
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
