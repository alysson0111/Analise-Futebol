import { analyzeFixtures, publicGame } from "./_lib/scanner.js";
import { fetchTotalCornerToday, totalCornerRowsToFixtures } from "./_lib/totalCorner.js";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.end(JSON.stringify(body));
}

function addTotalCornerStats(game, source) {
  const stats = [];
  if (source?.totalCorner) {
    stats.push(`TOTALCORNER | Escanteios | ${source.totalCorner.homeCorners}-${source.totalCorner.awayCorners}`);
    stats.push(`TOTALCORNER | Linha escanteios | ${Number(source.totalCorner.cornerLine || 0).toFixed(1)}`);
    if (source.totalCorner.goalLine) {
      stats.push(`TOTALCORNER | Linha gols | ${Number(source.totalCorner.goalLine || 0).toFixed(1)}`);
    }
    if (source.totalCorner.handicapLine !== null && source.totalCorner.handicapLine !== undefined) {
      const line = Number(source.totalCorner.handicapLine || 0);
      stats.push(`TOTALCORNER | Handicap | Mandante ${line > 0 ? "+" : ""}${line}`);
    }
  }

  return {
    ...game,
    dadosJogo: [
      `DADO | Gols no jogo | ${game.totalGoals}`,
      `DADO | Tempo/status | ${game.liveStatus || "-"}`,
      `DADO | Escanteios ao vivo | ${game.liveCorners}`,
      "DADO | Fonte ao vivo | TotalCorner"
    ],
    stats: [...stats, ...(game.stats || [])]
  };
}

async function fetchTotalCornerGames() {
  const totalCornerRows = await fetchTotalCornerToday();
  const rows = totalCornerRowsToFixtures(totalCornerRows);
  const analyzedRows = analyzeFixtures({ response: rows });
  const games = analyzedRows.map((game) => {
    const source = rows.find((row) => String(row.fixture.id) === String(game.sourceId));
    return addTotalCornerStats(publicGame(game), source);
  });

  return {
    updatedAt: new Date().toISOString(),
    count: rows.length,
    marketRows: games.length,
    source: "TotalCorner",
    totalCornerCount: totalCornerRows.length,
    games
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    send(res, 200, await fetchTotalCornerGames());
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar TotalCorner." });
  }
}
