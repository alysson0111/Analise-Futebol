import { apiJson } from "./apiFootball.js";

export function fetchTeam(teamId) {
  return apiJson(`/api/teams?id=${encodeURIComponent(teamId)}`);
}
