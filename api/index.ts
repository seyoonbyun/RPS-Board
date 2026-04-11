import { createApp } from "./_lib/app.js";

let appPromise: Promise<any> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = createApp().then(({ app }) => app);
  }
  const app = await appPromise;
  return app(req, res);
}
