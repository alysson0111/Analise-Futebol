const API_BASE = "https://v3.football.api-sports.io/odds";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const token = process.env.API_FOOTBALL_KEY;
    const fixture = req.query.fixture;
    if (!token) throw new Error("API_FOOTBALL_KEY nao configurada na Vercel.");
    if (!fixture) throw new Error("Informe o fixture.");

    const response = await fetch(`${API_BASE}?fixture=${encodeURIComponent(fixture)}`, {
      headers: { "x-apisports-key": token }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`API-Football retornou ${response.status}.`);
    send(res, 200, payload);
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar odds." });
  }
}
