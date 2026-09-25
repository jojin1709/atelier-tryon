export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  return res.status(200).json({
    ok: true,
    model_loaded: false,
    cloud_mode: true,
    decart_model: "lucy-vton-3.5",
    photo_res: [384, 512],
    live_sessions: 0,
  });
}
