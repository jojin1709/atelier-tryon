export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let body = {};
    if (typeof req.body === "string") {
      try { body = JSON.parse(req.body); } catch (e) {}
    } else if (req.body) {
      body = req.body;
    }

    const apiKey =
      (req.headers["x-api-key"] || "").trim() ||
      (body.apiKey || body.api_key || "").trim() ||
      (process.env.DECART_API_KEY || "").trim() ||
      "dct_fdsfgsgfsdfgfs_eNOBoCaSPNddmNDFZMpBumzNIqccnKrwSfRDRhklHXBnNEXEbakUwaelDBugkSLI";

    if (apiKey) {
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
          installation_id: body.installation_id || null,
        });
      }
    }

    // Fallback if no key or upstream error
    return res.status(200).json({
      apiKey: "local-free",
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      modelName: "catvton-local",
      prompt: "",
      cloud_enabled: false,
      installation_id: body.installation_id || null,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
