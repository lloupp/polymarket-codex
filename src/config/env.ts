export type AppEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  POLYMARKET_CLOB_HOST: string;
  POLYMARKET_GAMMA_HOST: string;
};

const REQUIRED_KEYS = ['POLYMARKET_CLOB_HOST', 'POLYMARKET_GAMMA_HOST'] as const;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): AppEnv {
  const missing = REQUIRED_KEYS.filter((key) => !input[key] || input[key]?.trim() === '');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const nodeEnv = (input.NODE_ENV ?? 'development') as AppEnv['NODE_ENV'];
  const rawPort = input.PORT ?? '3000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('Invalid PORT: expected a positive integer');
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    POLYMARKET_CLOB_HOST: input.POLYMARKET_CLOB_HOST as string,
    POLYMARKET_GAMMA_HOST: input.POLYMARKET_GAMMA_HOST as string
  };
}
