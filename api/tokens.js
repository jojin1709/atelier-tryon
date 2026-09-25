export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    let body = {};
    if (typeof req.body === "string") {
      try { body = JSON.parse(req.body); } catch (e) {}
    } else if (req.body) {
      body = req.body;
    }

    // Priority: ?k= query param (from config.js) > header > body > env
    const apiKey =
      (req.query && req.query.k ? decodeURIComponent(req.query.k) : "").trim() ||
      (req.headers["x-api-key"] || "").trim() ||
      (body.apiKey || body.api_key || "").trim() ||
      (process.env.DECART_API_KEY || "").trim();

    if (apiKey && apiKey.startsWith("dct_") && apiKey.length > 30) {
      const response = await fetch("https://api.decart.ai/v1/client/tokens", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expiresIn: 3600,
          allowedModels: ["lucy-vton-3.5", "lucy-vton-latest", "lucy-2.1"],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return res.status(200).json({
          apiKey: data.apiKey,
          token: data.token || data.apiKey,
          expiresAt: data.expiresAt || (Math.floor(Date.now() / 1000) + 3600),
          modelName: "lucy-vton-3.5",
          prompt: "",
          cloud_enabled: true,
          billing_enabled: false,
          installation_id: body.installation_id || null,
          timeouts: {},
        });
      }
    }

    // No valid key — return a stub so the widget shows a helpful message
    return res.status(200).json({
      apiKey: "no-key",
      expiresAt: Math.floor(Date.now() / 1000) + 60,
      modelName: "none",
      prompt: "",
      cloud_enabled: false,
      billing_enabled: false,
      no_key: true,
      installation_id: body.installation_id || null,
      timeouts: {},
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
