import { getMarketApp } from '../server';

export const config = {
  maxDuration: 30,
};

export default async function handler(req: any, res: any) {
  const app = await getMarketApp();
  return app(req, res);
}
