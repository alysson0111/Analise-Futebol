import { apiJson } from "../api/apiFootball.js";

export function listSignals() {
  return apiJson("/api/signals");
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
