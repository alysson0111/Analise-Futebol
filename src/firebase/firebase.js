import { apiJson } from "../api/serverApi.js";

export function listSignals(since = "") {
  const query = new URLSearchParams();
  if (since) query.set("since", since);
  return apiJson(`/api/signals?${query}`);
}

export function saveSignal(signal) {
  return apiJson("/api/signals", {
    method: "POST",
    body: JSON.stringify(signal)
  });
}

export function updateSignalResult(id, result, extra = {}) {
  return apiJson("/api/signals", {
    method: "PATCH",
    body: JSON.stringify({ id, result, ...extra })
  });
}

export function deleteSignal(id) {
  return apiJson("/api/signals", {
    method: "DELETE",
    body: JSON.stringify({ id })
  });
}
