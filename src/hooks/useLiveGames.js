import { useRef, useState } from "react";
import { fetchLiveFixtures } from "../api/fixtures.js";

export function useLiveGames(intervalMs) {
  const timerRef = useRef(null);
  const [games, setGames] = useState([]);
  const [active, setActive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("Aguardando ao vivo");
  const [statusText, setStatusText] = useState("Ao vivo parado");

  function stop() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setActive(false);
    setStatusText("Ao vivo parado");
  }

  async function refresh() {
    setStatusText("Consultando jogos ao vivo...");
    const payload = await fetchLiveFixtures();
    setGames(payload.games || []);
    setUpdatedAt(`Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${payload.count || 0} jogo(s) em andamento`);
    setStatusText("Ao vivo ativo");
  }

  async function start() {
    stop();
    setActive(true);
    await refresh();
    timerRef.current = window.setInterval(() => {
      refresh().catch((error) => {
        stop();
        setGames([]);
        setUpdatedAt(`Erro ao vivo: ${error.message}`);
      });
    }, Number(intervalMs || 60000));
  }

  return { games, active, updatedAt, statusText, start, stop, refresh };
}
