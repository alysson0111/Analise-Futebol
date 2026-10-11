import { useEffect, useRef, useState } from "react";
import { fetchLiveFixtures } from "../api/fixtures.js";

export function useLiveGames(intervalMs) {
  const timerRef = useRef(null);
  const activeRef = useRef(false);
  const refreshingRef = useRef(false);
  const intervalRef = useRef(Number(intervalMs || 30000));
  const lastUpdateRef = useRef("");
  const [games, setGames] = useState([]);
  const [active, setActive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("Aguardando ao vivo");
  const [statusText, setStatusText] = useState("Ao vivo parado");

  function scheduleNext() {
    if (!activeRef.current) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void refresh();
    }, intervalRef.current);
  }

  function stop() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    activeRef.current = false;
    setActive(false);
    setStatusText("Ao vivo parado");
  }

  async function refresh() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setStatusText("Consultando jogos ao vivo...");
    try {
      const payload = await fetchLiveFixtures();
      setGames(payload.games || []);
      lastUpdateRef.current = `Atualizado as ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} - ${payload.count || 0} jogo(s) em andamento`;
      setUpdatedAt(lastUpdateRef.current);
      setStatusText("Ao vivo ativo");
    } catch (error) {
      setUpdatedAt(`${lastUpdateRef.current ? `${lastUpdateRef.current} | Dados desatualizados. ` : ""}${error.message}`);
      setStatusText(activeRef.current ? "Falha na consulta. Tentando novamente automaticamente..." : "Falha na consulta ao vivo");
    } finally {
      refreshingRef.current = false;
      scheduleNext();
    }
  }

  async function start() {
    stop();
    intervalRef.current = Number(intervalMs || 30000);
    activeRef.current = true;
    setActive(true);
    await refresh();
  }

  useEffect(() => {
    intervalRef.current = Number(intervalMs || 30000);
    if (activeRef.current) scheduleNext();
  }, [intervalMs]);

  useEffect(() => () => stop(), []);

  return { games, active, updatedAt, statusText, start, stop, refresh };
}
