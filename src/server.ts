import { createApp } from './app';
import { loadEnv } from './config/env';

const env = loadEnv(process.env);
const app = createApp();

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
