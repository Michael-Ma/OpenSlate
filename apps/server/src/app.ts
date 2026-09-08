import Fastify from "fastify";
import { APP_NAME, type HealthResponse } from "@openslate/core";

export function createApp() {
  const app = Fastify({ logger: true });

  app.get<{ Reply: HealthResponse }>("/api/health", async () => ({
    name: APP_NAME,
    status: "ok",
    stage: "skeleton",
  }));

  return app;
}
