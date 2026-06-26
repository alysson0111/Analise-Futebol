export function currencyOdd(value) {
  return Number(value || 0).toFixed(2);
}

export function getTodayInput() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function escapeCsv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function calculateReport(signals) {
  const green = signals.filter((signal) => signal.result === "green").length;
  const red = signals.filter((signal) => signal.result === "red").length;
  const done = green + red;
  return {
    total: signals.length,
    green,
    red,
    hitRate: done ? Math.round((green / done) * 100) : 0
  };
}
