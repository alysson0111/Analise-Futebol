import { useState } from "react";
import { analyzePrematchWithAi } from "../api/aiAnalysis.js";
import { fetchPrematchFixtures } from "../api/fixtures.js";

export function usePrematchGames() {
  const [games, setGames] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("Aguardando busca por periodo");
  const [statusText, setStatusText] = useState("Pre-jogo");

  async function search(start, end) {
    setStatusText("Consultando periodo...");
    const payload = await fetchPrematchFixtures(start, end);
    setStatusText("Analisando pre-jogo com IA...");
    try {
      const aiPayload = await analyzePrematchWithAi(payload.games || []);
      setGames(aiPayload.games || payload.games || []);
      setUpdatedAt(`Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${payload.count || 0} jogo(s), ${aiPayload.aiCount || 0} sinal(is) por IA`);
      setStatusText(aiPayload.warning || "Pre-jogo atualizado por IA");
    } catch (error) {
      setGames(payload.games || []);
      setUpdatedAt(`Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${payload.count || 0} jogo(s), IA indisponivel`);
      setStatusText(`IA indisponivel: ${error.message}`);
    }
  }

  return { games, updatedAt, statusText, search };
}
