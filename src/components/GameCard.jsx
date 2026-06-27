import AnalysisBadge from "./AnalysisBadge.jsx";
import { currencyOdd } from "../analysis/scoreUtils.js";
import { getMarketLabel } from "../analysis/index.js";

function getStatClass(entry) {
  const value = String(entry || "").trim().toUpperCase();
  if (value.startsWith("OK |")) return "stat-line stat-ok";
  if (value.startsWith("NAO |") || value.startsWith("NÃO |")) return "stat-line stat-fail";
  if (value.startsWith("SEM DADO |")) return "stat-line stat-missing";
  if (value.startsWith("DADO |")) return "stat-line stat-data";
  if (value.startsWith("CLASSIFICACAO") || value.startsWith("CLASSIFICAÇÃO")) return "stat-line stat-grade";
  return "stat-line";
}

export default function GameCard({ games, updatedAt }) {
  if (!games.length) {
    return (
      <section className="table-panel panel">
        <div className="table-head">
          <h2>Lista de jogos</h2>
          <span className="subtitle">{updatedAt}</span>
        </div>
        <div className="empty">Nenhum jogo encontrado.</div>
      </section>
    );
  }

  return (
    <section className="table-panel panel">
      <div className="table-head">
        <h2>Lista de jogos</h2>
        <span className="subtitle">{updatedAt}</span>
      </div>
      <div className="table-wrap games-wrap">
        <table className="games-table">
          <thead>
            <tr>
              <th>Jogo</th>
              <th>Liga</th>
              <th>Tempo</th>
              <th>Placar</th>
              <th>Mercado</th>
              <th>Odd</th>
              <th>Data</th>
              <th>Confianca</th>
              <th>Sinais</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.key}>
                <td><strong>{game.home} x {game.away}</strong></td>
                <td>{game.league}</td>
                <td>{game.liveStatus || game.time || "-"}</td>
                <td>{game.scoreText || "-"}</td>
                <td>{game.analise?.label || game.marketLabel || getMarketLabel(game.market)}</td>
                <td>{currencyOdd(game.analise?.odd ?? game.odd)}</td>
                <td>{game.dateText || "-"}</td>
                <td>{Math.round(Number(game.analise?.confianca ?? game.confidence ?? 0))}%</td>
                <td>
                  <div className="stats">
                    {(game.analise?.dadosJogo || game.dadosJogo || []).map((entry) => <span className={getStatClass(entry)} key={entry}>{entry}</span>)}
                    {(game.analise?.sinais || game.stats || []).slice(0, 6).map((entry) => <span className={getStatClass(entry)} key={entry}>{entry}</span>)}
                    {!((game.analise?.dadosJogo || game.dadosJogo || []).length || (game.analise?.sinais || game.stats || []).length) && <span className="stat-line stat-missing">Sem dados da API</span>}
                  </div>
                </td>
                <td><AnalysisBadge status={game.analise?.statusOriginal || game.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
