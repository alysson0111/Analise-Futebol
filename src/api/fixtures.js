import { apiJson } from "./apiFootball.js";

export function fetchLiveFixtures() {
  return apiJson("/api/games?mode=live");
}

export function fetchPrematchFixtures(start, end) {
  return apiJson(`/api/games?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}
