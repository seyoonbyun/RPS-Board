export default function handler(req: any, res: any) {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
  const keyAfterReplace = key.replace(/\\n/g, '\n');

  res.status(200).json({
    keyLength: key.length,
    keyAfterReplaceLength: keyAfterReplace.length,
    startsWithDash: key.startsWith("-----"),
    startsWithQuote: key.startsWith('"'),
    first30: key.substring(0, 30),
    last30: key.substring(key.length - 30),
    containsLiteralBackslashN: key.includes("\\n"),
    containsRealNewline: key.includes("\n"),
    newlineCount: (key.match(/\n/g) || []).length,
    literalBackslashNCount: (key.match(/\\n/g) || []).length,
    afterReplace_startsWithDash: keyAfterReplace.startsWith("-----"),
    afterReplace_newlineCount: (keyAfterReplace.match(/\n/g) || []).length,
  });
}
