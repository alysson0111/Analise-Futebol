const MARKETS = ["over05", "over25", "under25", "corners"];

const MARKET_LABELS = {
  over05: "+0.5 gols",
  over25: "+2.5 gols",
  under25: "Under 2.5",
  corners: "Escanteios"
};

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asBool(value) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "sim";
}

function percent(value, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(asNumber(value, fallback))));
}

function item(label, passed, value, available = true) {
  return { label, passed: Boolean(passed), value, available: Boolean(available) };
}

function summary(items) {
  return items.map((entry) => {
    if (!entry.available) return `SEM DADO | ${entry.label} | ${entry.value}`;
    return `${entry.passed ? "OK" : "NAO"} | ${entry.label} | ${entry.value}`;
  });
}

function result(game, patch, checks) {
  return {
    ...game,
    ...patch,
    scannerChecks: checks,
    stats: summary(checks)
  };
}

function scanOver05(game) {
  const checks = [
    item("Ambos marcam acima do limite", game.bttsPercent > 55, `${game.bttsPercent}%`, game.hasHistory),
    item("Media conjunta de gols suficiente", game.avgGoalsTotal > 2.5, `${game.avgGoalsTotal.toFixed(2)}`, game.hasHistory),
    item("xG conjunto suficiente", game.xgTotal > 2.3, game.xgAvailable ? game.xgTotal.toFixed(2) : "indisponivel", game.xgAvailable),
    item("Sem 0x0 recente nos dois times", game.zeroZeroLast5Both === 0, `${game.zeroZeroLast5Both}`, game.hasHistory)
  ];
  const passed = checks.every((entry) => entry.available && entry.passed);
  return result(game, {
    confidence: passed ? 78 : 0,
    odd: game.odd || 1,
    status: passed ? "Entrada" : "Observar"
  }, checks);
}

function scanOver25(game) {
  const oddOk = game.over25Odd >= 1.7 && game.over25Odd <= 2.1;
  const checks = [
    item("Media de gols dos dois times alta", game.avgGoalsBothTeams > 2.8, `${game.avgGoalsBothTeams.toFixed(2)}`, game.hasHistory),
    item("Favorito jogando em casa", game.favoriteAtHome, game.favoriteAtHome ? "sim" : "nao", game.hasModel),
    item("BTTS recente acima do limite", game.bttsLast10Percent >= 60, `${game.bttsLast10Percent}%`, game.hasHistory),
    item("Media de finalizacoes alta", game.avgShotsPerGame > 10, `${game.avgShotsPerGame.toFixed(1)}`, game.hasShots),
    item("Odd Over 2.5 na faixa", oddOk, game.over25Odd ? game.over25Odd.toFixed(2) : "indisponivel", Boolean(game.over25Odd))
  ];
  const passed = checks.every((entry) => entry.available && entry.passed);
  return result(game, {
    confidence: passed ? 82 : 0,
    odd: game.over25Odd || game.odd || 1,
    status: passed ? "Entrada" : "Observar"
  }, checks);
}

function scanUnder25(game) {
  const oddOk = !game.under25Odd || (game.under25Odd >= 1.7 && game.under25Odd <= 2.2);
  const checks = [
    item("Times marcam pouco", game.avgGoalsForBothTeams <= 1.2, `${game.avgGoalsForBothTeams.toFixed(2)}`, game.hasHistory),
    item("Times sofrem pouco", game.avgGoalsAgainstBothTeams <= 1.2, `${game.avgGoalsAgainstBothTeams.toFixed(2)}`, game.hasHistory),
    item("Over 2.5 baixo no historico", game.over25Percent <= 40, `${game.over25Percent}%`, game.hasHistory),
    item("Ambas marcam baixo", game.bttsPercent <= 50, `${game.bttsPercent}%`, game.hasHistory),
    item("xG baixo", game.xgTotal <= 2.5, game.xgAvailable ? game.xgTotal.toFixed(2) : "indisponivel", game.xgAvailable),
    item("Finalizacoes certas somadas baixas", game.shotsOnTargetTotal <= 8, `${game.shotsOnTargetTotal.toFixed(1)}`, game.hasShots),
    item("Poucos gols no primeiro tempo", game.firstHalfGoalPercent < 60, `${game.firstHalfGoalPercent}%`, game.hasHistory),
    item("Nao e jogo decisivo", !game.decisiveGame, game.decisiveGame ? "decisivo" : "normal", true),
    item("Odd Under 2.5 na faixa", oddOk, game.under25Odd ? game.under25Odd.toFixed(2) : "sem odd, nao bloqueia", true),
    item("Liga favoravel ou neutra", game.underFriendlyLeague, game.underFriendlyLeague ? "ok" : "ruim", true)
  ];
  const points = checks.filter((entry) => entry.available && entry.passed).length;
  const grade = points === 10 ? "A+" : points === 9 ? "A" : points === 8 ? "B+" : points === 7 ? "B" : "Descarta";
  const passed = points >= 8;
  return result(game, {
    confidence: passed ? Math.min(92, 58 + points * 4) : 0,
    odd: game.under25Odd || game.odd || 1,
    grade,
    status: passed ? "Entrada" : "Observar",
    statsPrefix: `CLASSIFICACAO ${grade} (${points}/10)`
  }, checks);
}

function scanCorners(game) {
  const checks = [
    item("Favorito joga em casa", game.homeFavoriteByModel, game.homeFavoriteByModel ? "sim" : "nao", game.hasModel),
    item("Media conjunta de escanteios alta", game.avgCornersTotal > 10, `${game.avgCornersTotal.toFixed(1)}`, game.hasCorners),
    item("Favorito finaliza bastante", game.favoriteAvgShots > 10, `${game.favoriteAvgShots.toFixed(1)}`, game.hasShots)
  ];
  const passed = checks.every((entry) => entry.available && entry.passed);
  const probability = passed ? Math.max(65, Math.min(88, Math.round(55 + (game.avgCornersTotal - 10) * 10))) : 0;
  return result(game, {
    confidence: probability,
    odd: game.odd || 1,
    status: passed ? "Entrada" : "Observar",
    generatedSignals: passed ? ["Over 8.5 escanteios", "Over 9.5 escanteios", "Over 10.5 escanteios"] : []
  }, checks);
}

function getRows(payload) {
  return Array.isArray(payload) ? payload : payload.response || payload.data || payload.games || [];
}

function getStatTotal(row, type) {
  return (row.liveStats || []).reduce((sum, teamStats) => {
    const stat = (teamStats.statistics || []).find((entry) => entry.type === type);
    return sum + asNumber(stat?.value);
  }, 0);
}

function getStatMax(row, type) {
  return Math.max(0, ...(row.liveStats || []).map((teamStats) => {
    const stat = (teamStats.statistics || []).find((entry) => entry.type === type);
    return asNumber(stat?.value);
  }));
}

function buildGameData({ totalGoals, liveCorners, liveShots, liveShotsOnTarget, elapsed, apiStatus, hasLiveStats }) {
  const data = [
    `DADO | Gols no jogo | ${totalGoals}`,
    `DADO | Tempo/status | ${elapsed ? `${elapsed}'` : apiStatus || "-"}`
  ];

  if (hasLiveStats) {
    data.push(`DADO | Escanteios ao vivo | ${liveCorners}`);
    data.push(`DADO | Finalizacoes ao vivo | ${liveShots}`);
    data.push(`DADO | Finalizacoes no alvo | ${liveShotsOnTarget}`);
  } else {
    data.push("DADO | Estatisticas ao vivo | API nao trouxe estatisticas");
  }

  return data;
}

function normalizeFixture(row) {
  const kickoff = row.fixture?.date ? new Date(row.fixture.date) : null;
  const homeGoals = asNumber(row.goals?.home);
  const awayGoals = asNumber(row.goals?.away);
  const totalGoals = homeGoals + awayGoals;
  const elapsed = row.fixture?.status?.elapsed;
  const apiStatus = row.fixture?.status?.short;
  const liveCorners = getStatTotal(row, "Corner Kicks");
  const liveShots = getStatTotal(row, "Total Shots");
  const liveShotsOnTarget = getStatTotal(row, "Shots on Goal");
  const favoriteShots = getStatMax(row, "Total Shots") || getStatMax(row, "Shots on Goal");
  const hasLiveStats = Boolean((row.liveStats || []).length);
  const hasHistory = Boolean(row.bothTeamsScorePercent || row.bttsPercent || row.avgGoalsTotal || row.mediaGolsConjunta);

  return {
    sourceId: String(row.fixture?.id || `${row.teams?.home?.name}-${row.teams?.away?.name}-${row.fixture?.date}`),
    home: row.teams?.home?.name || "Mandante",
    away: row.teams?.away?.name || "Visitante",
    league: row.league?.name || "Liga",
    time: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--",
    dateText: kickoff && !Number.isNaN(kickoff.getTime()) ? kickoff.toLocaleDateString("pt-BR") : "-",
    liveStatus: elapsed ? `${elapsed}'` : apiStatus || "",
    scoreText: `${homeGoals}x${awayGoals}`,
    totalGoals,
    liveCorners,
    liveShots,
    liveShotsOnTarget,
    dadosJogo: buildGameData({ totalGoals, liveCorners, liveShots, liveShotsOnTarget, elapsed, apiStatus, hasLiveStats }),
    odd: 1,
    bttsPercent: percent(row.bothTeamsScorePercent || row.bttsPercent || row.ambosMarcamPercentual),
    avgGoalsTotal: asNumber(row.avgGoalsTotal || row.mediaGolsConjunta || row.averageGoalsTotal || totalGoals),
    xgTotal: asNumber(row.xgTotal || row.xgConjunto || row.expectedGoalsTotal),
    xgAvailable: Boolean(row.xgTotal || row.xgConjunto || row.expectedGoalsTotal),
    zeroZeroLast5Both: asNumber(row.zeroZeroLast5Both || row.zeroAZeroUltimos5Ambos),
    avgGoalsBothTeams: asNumber(row.avgGoalsBothTeams || row.mediaGolsDoisTimes || row.averageGoalsBothTeams || totalGoals),
    favoriteAtHome: asBool(row.favoriteAtHome || row.favoritoEmCasa || row.homeFavorite),
    bttsLast10Percent: percent(row.bothTeamsScoredLast10Percent || row.ambosMarcaramUltimos10Percentual || row.bttsLast10Percent),
    avgShotsPerGame: asNumber(row.avgShotsPerGame || row.mediaFinalizacoes || row.averageShotsPerGame || liveShots),
    over25Odd: asNumber(row.over25Odd || row.oddOver25 || row.overTwoPointFiveOdd),
    homeFavoriteByModel: asBool(row.homeFavoriteByModel || row.favoritoMandanteModelo || row.favoritoEmCasaModelo),
    avgCornersTotal: asNumber(row.avgCornersTotal || row.mediaEscanteiosConjunta || row.averageCornersTotal || liveCorners),
    favoriteAvgShots: asNumber(row.favoriteAvgShots || row.mediaFinalizacoesFavorito || row.favoriteAverageShots || favoriteShots),
    avgGoalsForBothTeams: asNumber(row.avgGoalsForBothTeams || row.mediaGolsMarcadosTimes),
    avgGoalsAgainstBothTeams: asNumber(row.avgGoalsAgainstBothTeams || row.mediaGolsSofridosTimes),
    over25Percent: percent(row.over25Percent || row.percentualOver25 || row.overTwoPointFivePercent),
    shotsOnTargetTotal: asNumber(row.shotsOnTargetTotal || row.finalizacoesCertasSomadas || liveShotsOnTarget),
    firstHalfGoalPercent: percent(row.firstHalfGoalPercent || row.percentualGolPrimeiroTempo),
    decisiveGame: asBool(row.decisiveGame || row.jogoDecisivo),
    under25Odd: asNumber(row.under25Odd || row.oddUnder25 || row.underTwoPointFiveOdd),
    underFriendlyLeague: row.underFriendlyLeague === undefined ? true : asBool(row.underFriendlyLeague),
    hasHistory,
    hasModel: Boolean(row.favoriteAtHome || row.homeFavoriteByModel || row.favoritoEmCasaModelo),
    hasShots: hasLiveStats || Boolean(row.avgShotsPerGame || row.favoriteAvgShots || row.mediaFinalizacoes),
    hasCorners: hasLiveStats || Boolean(row.avgCornersTotal || row.mediaEscanteiosConjunta)
  };
}

export function analyzeFixtures(payload) {
  return getRows(payload).flatMap((row) => {
    if (!row.fixture || !row.teams) return [];
    const base = normalizeFixture(row);
    return MARKETS.map((market) => {
      const game = { ...base, market, marketLabel: MARKET_LABELS[market] };
      if (market === "over05") return scanOver05(game);
      if (market === "over25") return scanOver25(game);
      if (market === "under25") return scanUnder25(game);
      return scanCorners(game);
    });
  });
}

export function publicGame(game) {
  return {
    key: `${game.sourceId}-${game.market}`,
    sourceId: game.sourceId,
    home: game.home,
    away: game.away,
    league: game.league,
    time: game.time,
    dateText: game.dateText,
    liveStatus: game.liveStatus,
    scoreText: game.scoreText,
    totalGoals: game.totalGoals,
    liveCorners: game.liveCorners,
    liveShots: game.liveShots,
    liveShotsOnTarget: game.liveShotsOnTarget,
    dadosJogo: game.dadosJogo || [],
    market: game.market,
    marketLabel: game.marketLabel,
    odd: game.odd,
    confidence: game.confidence,
    status: game.status,
    grade: game.grade || "",
    signals: game.generatedSignals || [],
    stats: game.statsPrefix ? [game.statsPrefix, ...game.stats] : game.stats
  };
}
