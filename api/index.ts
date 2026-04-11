import { HELLO } from "./_hello.js";

export default function handler(req: any, res: any) {
  res.status(200).json({
    ok: true,
    step: "1c — explicit .js extension",
    hello: HELLO,
    url: req.url,
    method: req.method,
  });
}
