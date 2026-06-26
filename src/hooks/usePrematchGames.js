import { useState } from "react";
import { fetchPrematchFixtures } from "../api/fixtures.js";

export function usePrematchGames() {
  const [games, setGames] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("Aguardando busca por periodo");
  const [statusText, setStatusText] = useState("Pre-jogo");

  async function search(start, end) {
    setStatusText("Consultando periodo...");
    const payload = await fetchPrematchFixtures(start, end);
    setGames(payload.games || []);
    setUpdatedAt(`Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${payload.count || 0} jogo(s) recebido(s)`);
    setStatusText("Pre-jogo atualizado");
  }

  return { games, updatedAt, statusText, search };
}
