import { apiJson } from "./apiFootball.js";

export function fetchFixtureStatistics(fixtureId) {
  return apiJson(`/api/statistics?fixture=${encodeURIComponent(fixtureId)}`);
}
