import { useState } from "react";
import { analyzePrematchWithForebet } from "../api/forebetAnalysis.js";
import { fetchPrematchFixtures } from "../api/fixtures.js";

export function usePrematchGames() {
  const [games, setGames] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("Aguardando busca por periodo");
  const [statusText, setStatusText] = useState("Pre-jogo");

  async function search(start, end) {
    setStatusText("Consultando periodo...");
    const payload = await fetchPrematchFixtures(start, end);
    setStatusText("Consultando analise do Forebet...");
    try {
      const forebetPayload = await analyzePrematchWithForebet(payload.games || [], start, end);
      setGames(forebetPayload.games || payload.games || []);
      setUpdatedAt(`Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${payload.count || 0} jogo(s), ${forebetPayload.forebetCount || 0} sinal(is) Forebet`);
      setStatusText(`Forebet: ${forebetPayload.forebetGoalsCount || 0} over gols e ${forebetPayload.forebetCornersCount || 0} escanteios`);
    } catch (error) {
      setGames(payload.games || []);
      setUpdatedAt(`Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${payload.count || 0} jogo(s), Forebet indisponivel`);
      setStatusText(`Forebet indisponivel: ${error.message}`);
    }
  }

  return { games, updatedAt, statusText, search };
}
