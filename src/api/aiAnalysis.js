import { apiJson } from "./apiFootball.js";

export function analyzePrematchWithAi(games) {
  return apiJson("/api/ai-analysis", {
    method: "POST",
    body: JSON.stringify({ games })
  });
}
