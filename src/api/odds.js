import { apiJson } from "./apiFootball.js";

export function fetchFixtureOdds(fixtureId) {
  return apiJson(`/api/odds?fixture=${encodeURIComponent(fixtureId)}`);
}
