import { useMemo, useState } from "react";
import FiltersBar from "../components/FiltersBar.jsx";
import GameCard from "../components/GameCard.jsx";
import StatsBox from "../components/StatsBox.jsx";
import { getMarketLabel } from "../analysis/index.js";
import { calculateReport, currencyOdd, escapeCsv, getTodayInput } from "../analysis/scoreUtils.js";

const REPORT_MARKETS = ["all", "over05", "over15", "over25", "under25", "corners"];

export default function Dashboard(props) {
  const title = props.title || "Radar de oportunidades";
  const subtitle = props.subtitle || "Jogos analisados pelos scanners internos do sistema.";

  return (
    <main className="main">
      <Topbar {...props} title={title} subtitle={subtitle} />
      <SearchBar {...props} />
      <FiltersBar {...props} />
      <StatsBox metrics={props.metrics} />
      <GameCard games={props.games} updatedAt={props.updatedAt} />
      <SignalsReport {...props} />
    </main>
  );
}

export function Topbar({ title, subtitle, onLive, onPrematch, onStopLive, liveActive }) {
  return (
    <section className="topbar">
      <div>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onLive}>Jogos em Andamento</button>
        <button className="btn primary" onClick={onPrematch}>Atualizar analise</button>
        <button className="btn primary" onClick={onLive}>{liveActive ? "Ao vivo ativo" : "Ao vivo"}</button>
        <button className="btn" onClick={onStopLive} disabled={!liveActive}>Parar ao vivo</button>
      </div>
    </section>
  );
}

export function SearchBar({ dateStart, setDateStart, dateEnd, setDateEnd, liveInterval, setLiveInterval, onPrematch }) {
  return (
    <section className="date-search panel" aria-label="Busca por periodo">
      <div className="field">
        <label htmlFor="dateStart">Data inicial</label>
        <input id="dateStart" type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="dateEnd">Data final</label>
        <input id="dateEnd" type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="sourceInfo">Fonte</label>
        <input id="sourceInfo" value="Servidor seguro" readOnly />
      </div>
      <div className="field">
        <label htmlFor="liveInterval">Ao vivo</label>
        <select id="liveInterval" value={liveInterval} onChange={(event) => setLiveInterval(Number(event.target.value))}>
          <option value="30000">30 segundos</option>
          <option value="60000">60 segundos</option>
          <option value="120000">2 minutos</option>
        </select>
      </div>
      <button className="btn primary" onClick={onPrematch}>Buscar periodo</button>
    </section>
  );
}

export function SignalsReport({ signals, bankStatus, changeSignalResult, removeSignal }) {
  const [reportMarket, setReportMarket] = useState("all");
  const filteredSignals = useMemo(() => {
    if (reportMarket === "all") return signals;
    return signals.filter((signal) => signal.market === reportMarket);
  }, [signals, reportMarket]);
  const report = calculateReport(filteredSignals);
  const resultLabel = { green: "Green", red: "Red", pendente: "Pendente" };

  function exportCsv() {
    const header = ["data_hora", "jogo", "liga", "resultado_final", "mercado", "odd", "confianca", "resultado", "scanner"];
    const rows = filteredSignals.map((signal) => [
      signal.createdAtText || "",
      `${signal.home} x ${signal.away}`,
      signal.league || "",
      signal.scoreText || "",
      signal.marketLabel || signal.market || "",
      signal.odd || "",
      `${Math.round(Number(signal.confidence || 0))}%`,
      signal.result || "pendente",
      (signal.stats || []).join(" | ")
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio-sinais-${getTodayInput()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportPdf() {
    const win = window.open("", "_blank");
    if (!win) return;
    const selectedMarketLabel = reportMarket === "all" ? "Todos" : getMarketLabel(reportMarket);
    const rows = filteredSignals.map((signal) => `
      <tr>
        <td>${signal.createdAtText || "-"}</td>
        <td>${signal.home} x ${signal.away}</td>
        <td>${signal.league || "-"}</td>
        <td>${signal.scoreText || "-"}</td>
        <td>${signal.marketLabel || signal.market}</td>
        <td>${currencyOdd(signal.odd)}</td>
        <td>${Math.round(Number(signal.confidence || 0))}%</td>
        <td>${signal.result || "pendente"}</td>
      </tr>
    `).join("");
    win.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <title>Relatorio de sinais</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #17211c; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #dbe5df; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #eef4ef; }
          </style>
        </head>
        <body>
          <h1>Relatorio de sinais</h1>
          <p>Mercado: ${selectedMarketLabel}</p>
          <table>
            <thead><tr><th>Data/Hora</th><th>Jogo</th><th>Liga</th><th>Resultado final</th><th>Mercado</th><th>Odd</th><th>Confianca</th><th>Resultado</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <section className="report-grid">
      <div className="report-box panel">
        <div className="report-head">
          <div>
            <h2>Relatorio de sinais</h2>
            <p className="subtitle">{bankStatus}</p>
          </div>
          <div className="report-actions">
            <select
              className="report-select"
              value={reportMarket}
              onChange={(event) => setReportMarket(event.target.value)}
              aria-label="Mercado do relatorio"
            >
              {REPORT_MARKETS.map((market) => (
                <option key={market} value={market}>{market === "all" ? "Todos os mercados" : getMarketLabel(market)}</option>
              ))}
            </select>
            <button className="btn" onClick={exportCsv}>Excel CSV</button>
            <button className="btn" onClick={exportPdf}>PDF</button>
          </div>
        </div>
        <div className="mini-stats">
          <div className="mini-stat"><span>Total</span><strong>{report.total}</strong></div>
          <div className="mini-stat"><span>Green</span><strong>{report.green}</strong></div>
          <div className="mini-stat"><span>Red</span><strong>{report.red}</strong></div>
          <div className="mini-stat"><span>Assertividade</span><strong>{report.hitRate}%</strong></div>
          <div className="mini-stat"><span>ROI</span><strong>{report.roi}%</strong></div>
        </div>
        <div className="table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Jogo</th>
                <th>Liga</th>
                <th>Resultado final</th>
                <th>Mercado</th>
                <th>Odd</th>
                <th>Confianca</th>
                <th>Resultado</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {!filteredSignals.length && <tr><td colSpan="9" className="empty">Nenhum sinal salvo neste mercado.</td></tr>}
              {filteredSignals.map((signal) => (
                <tr key={signal.id}>
                  <td>{signal.createdAtText || "-"}</td>
                  <td>{signal.home} x {signal.away}</td>
                  <td>{signal.league || "-"}</td>
                  <td>{signal.scoreText || "-"}</td>
                  <td>{signal.marketLabel || signal.market}</td>
                  <td>{currencyOdd(signal.odd)}</td>
                  <td>{Math.round(Number(signal.confidence || 0))}%</td>
                  <td>
                    <span className={`result-pill ${signal.result === "green" ? "green" : signal.result === "red" ? "red" : "pending"}`}>
                      {resultLabel[signal.result] || "Pendente"}
                    </span>
                  </td>
                  <td className="report-actions-cell">
                    <button className="btn green" onClick={() => changeSignalResult(signal.id, "green")}>Green</button>
                    <button className="btn red" onClick={() => changeSignalResult(signal.id, "red")}>Red</button>
                    <button className="btn red" onClick={() => removeSignal(signal.id)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
