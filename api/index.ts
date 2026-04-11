import { HELLO } from "./_hello";

export default function handler(req: any, res: any) {
  res.status(200).json({
    ok: true,
    step: "1b — sibling file import",
    hello: HELLO,
    url: req.url,
    method: req.method,
  });
}
