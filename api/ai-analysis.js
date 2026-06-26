const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const MARKET_LABELS = {
  over05: "+0.5 gols",
  over15: "+1.5 gols",
  over25: "+2.5 gols"
};

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function uniqueFixtures(games) {
  const map = new Map();
  for (const game of games || []) {
    const key = game.sourceId || game.key;
    if (!key || map.has(key)) continue;
    map.set(key, {
      sourceId: key,
      home: game.home,
      away: game.away,
      league: game.league,
      dateText: game.dateText,
      time: game.time
    });
  }
  return [...map.values()];
}

function normalizeMarket(value, bets = []) {
  const text = `${value || ""} ${bets.join(" ")}`.toLowerCase();
  if (text.includes("over 2.5") || text.includes("over 2,5") || text.includes("+2.5") || text.includes("+2,5")) return "over25";
  if (text.includes("over 1.5") || text.includes("over 1,5") || text.includes("+1.5") || text.includes("+1,5")) return "over15";
  if (text.includes("over 0.5") || text.includes("over 0,5") || text.includes("+0.5") || text.includes("+0,5")) return "over05";
  return "";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("IA retornou resposta fora do formato JSON.");
  }
}

function applyAiPicks(games, picks) {
  const byGame = new Map();
  for (const pick of picks || []) {
    const bestBets = Array.isArray(pick.bestBets) ? pick.bestBets : [];
    const market = normalizeMarket(pick.market, bestBets);
    if (!market || !MARKET_LABELS[market]) continue;
    byGame.set(String(pick.sourceId), {
      ...pick,
      market,
      bestBets
    });
  }

  return (games || []).map((game) => {
    const pick = byGame.get(String(game.sourceId || ""));
    if (!pick) return game;

    if (game.market !== pick.market) {
      return {
        ...game,
        confidence: 0,
        status: "Observar",
        stats: [`IA | Melhor mercado encontrado | ${MARKET_LABELS[pick.market]}`]
      };
    }

    return {
      ...game,
      market: pick.market,
      marketLabel: MARKET_LABELS[pick.market],
      confidence: Math.max(60, Math.min(95, Number(pick.confidence || 72))),
      status: "Entrada",
      stats: [
        `IA | Melhor aposta | ${MARKET_LABELS[pick.market]}`,
        `IA | Melhores apostas | ${pick.bestBets.slice(0, 4).join("; ") || MARKET_LABELS[pick.market]}`,
        `IA | Motivo | ${pick.reason || "Analise pre-jogo por IA"}`
      ]
    };
  });
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body;
}

async function askOpenAi(fixtures) {
  const token = process.env.OPENAI_API_KEY;
  if (!token) {
    return {
      warning: "OPENAI_API_KEY nao configurada na Vercel. Pre-jogo voltou sem analise por IA.",
      picks: []
    };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "Voce e um analista pre-jogo de futebol.",
            "Receba fixtures da API e escolha apenas oportunidades de over gols.",
            "Use os nomes dos times e liga para sugerir o mercado de over mais adequado.",
            "Nao escolha vencedor, dupla chance ou ambas marcam como mercado principal.",
            "Retorne JSON puro com o formato:",
            "{\"picks\":[{\"sourceId\":\"...\",\"market\":\"over05|over15|over25\",\"confidence\":72,\"bestBets\":[\"Over 1.5 gols\"],\"reason\":\"motivo curto\"}]}",
            "Se nao houver uma boa aposta de over gols para o jogo, omita o jogo."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction: "Analise estes jogos pre-jogo. Onde houver melhores apostas com over gols, envie para o mercado especifico.",
            fixtures: fixtures.slice(0, 180)
          })
        }
      ]
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI retornou ${response.status}.`);
  const content = payload.choices?.[0]?.message?.content || "{}";
  return parseJson(content);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });

  try {
    const body = readBody(req);
    const games = Array.isArray(body.games) ? body.games : [];
    const fixtures = uniqueFixtures(games);
    const ai = await askOpenAi(fixtures);
    const analyzedGames = applyAiPicks(games, ai.picks || []);

    send(res, 200, {
      games: analyzedGames,
      aiCount: (ai.picks || []).length,
      warning: ai.warning || "",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    send(res, 500, { error: error.message || "Erro ao analisar pre-jogo com IA." });
  }
}
