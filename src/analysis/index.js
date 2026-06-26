import { over05 } from "./over05.js";
import { over15 } from "./over15.js";
import { over25 } from "./over25.js";
import { under25 } from "./under25.js";
import { corners } from "./corners.js";

export const markets = {
  over05,
  over15,
  over25,
  under25,
  corners
};

export function getMarketLabel(market) {
  return markets[market]?.label || market;
}

export function analisarMercado(jogo, mercadoSelecionado = "all") {
  const mercado = mercadoSelecionado !== "all" ? mercadoSelecionado : jogo.market;
  const status = jogo.status || "Observar";
  const confianca = Number(jogo.confidence || 0);
  const odd = Number(jogo.odd || 0);
  const sinais = Array.isArray(jogo.stats) ? jogo.stats : [];

  return {
    mercado,
    label: jogo.marketLabel || getMarketLabel(mercado),
    status,
    confianca,
    odd,
    sinais,
    entrada: status === "Entrada",
    grade: jogo.grade || "",
    linhas: jogo.signals || []
  };
}
