import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

try {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
