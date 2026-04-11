export default function handler(req: any, res: any) {
  res.status(200).json({
    ok: true,
    message: "Minimal handler alive",
    url: req.url,
    method: req.method,
    now: new Date().toISOString(),
  });
}
