import AnalysisBadge from "./AnalysisBadge.jsx";
import { currencyOdd } from "../analysis/scoreUtils.js";
import { getMarketLabel } from "../analysis/index.js";

export default function GameCard({ games, updatedAt, onSave }) {
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
              <th>Registro</th>
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
                    {(game.analise?.sinais || game.stats || []).slice(0, 8).map((entry) => <span key={entry}>{entry}</span>)}
                    {!(game.analise?.sinais || game.stats || []).length && <span>Sem sinal pelo scanner</span>}
                  </div>
                </td>
                <td><AnalysisBadge status={game.analise?.status || game.status} /></td>
                <td>{(game.analise?.entrada || game.status === "Entrada") && <button className="btn" onClick={() => onSave(game)}>Salvar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
