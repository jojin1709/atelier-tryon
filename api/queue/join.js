export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Import tokens handler inline to get a token
  let token = { apiKey: "cloud-free", expiresAt: Math.floor(Date.now() / 1000) + 3600 };

  try {
    const DECART_API_KEY = (process.env.DECART_API_KEY || "").trim() ||
      "dct_fdsfgsgfsdfgfs_eNOBoCaSPNddmNDFZMpBumzNIqccnKrwSfRDRhklHXBnNEXEbakUwaelDBugkSLI";

    const upstream = await fetch("https://api.decart.ai/v1/client/tokens", {
      method: "POST",
      headers: { "x-api-key": DECART_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600, allowedModels: ["lucy-vton-3.5"] }),
    });
    if (upstream.ok) {
      const d = await upstream.json();
      if (d.apiKey) token = { apiKey: d.apiKey, token: d.token || d.apiKey, expiresAt: d.expiresAt };
    }
  } catch (_) {}

  return res.status(200).json({
    status: "active",
    ticket_id: "cloud-" + Math.random().toString(36).slice(2, 14),
    position: 0,
    poll_ms: 2500,
    lane: "cloud",
    lane_label: "",
    eta_text: "",
    cta_visible: false,
    token,
    billing_enabled: false,
  });
}
