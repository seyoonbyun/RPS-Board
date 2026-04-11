// @ts-ignore - produced by the esbuild step in `npm run build`
import { createApp } from "../dist/index.js";

let appPromise: Promise<any> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = createApp().then(({ app }: any) => app);
  }
  const app = await appPromise;
  return app(req, res);
}
