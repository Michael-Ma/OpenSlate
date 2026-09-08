import { createApp } from "./app.js";

const app = createApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().catch((error: unknown) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: "127.0.0.1", port: 3001 });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
