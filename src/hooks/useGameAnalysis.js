import { useMemo } from "react";

export function useGameAnalysis(games, filters) {
  return useMemo(() => {
    const leagues = [...new Set(games.map((game) => game.league).filter(Boolean))].sort();
    const filteredGames = games.filter((game) => {
      if (filters.league !== "all" && game.league !== filters.league) return false;
      if (filters.market !== "all" && game.market !== filters.market) return false;
      if (Number(game.confidence || 0) < Number(filters.minConfidence || 0)) return false;
      if (Number(game.odd || 0) < Number(filters.minOdd || 1)) return false;
      const search = String(filters.search || "").trim().toLowerCase();
      if (search && !`${game.home} ${game.away} ${game.league}`.toLowerCase().includes(search)) return false;
      return true;
    });

    const entries = filteredGames.filter((game) => game.status === "Entrada");
    const oddAvg = entries.length ? entries.reduce((sum, game) => sum + Number(game.odd || 0), 0) / entries.length : 0;
    const confidenceAvg = entries.length ? entries.reduce((sum, game) => sum + Number(game.confidence || 0), 0) / entries.length : 0;
    const marketCounts = games.reduce((acc, game) => {
      if (game.status === "Entrada") acc[game.market] = (acc[game.market] || 0) + 1;
      return acc;
    }, {});

    return {
      leagues,
      filteredGames,
      marketCounts,
      metrics: {
        games: filteredGames.length,
        entries: entries.length,
        oddAvg,
        confidenceAvg
      }
    };
  }, [games, filters]);
}
