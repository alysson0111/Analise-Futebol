const API_BASE = "https://v3.football.api-sports.io/teams";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const token = process.env.API_FOOTBALL_KEY;
    const id = req.query.id;
    if (!token) throw new Error("API_FOOTBALL_KEY nao configurada na Vercel.");
    if (!id) throw new Error("Informe o time.");

    const response = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`, {
      headers: { "x-apisports-key": token }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`API-Football retornou ${response.status}.`);
    send(res, 200, payload);
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao consultar time." });
  }
}
