import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const { app, history } = createApp(config);

const server = app.listen(config.port, () => {
  console.log(`HealthAI listening on http://localhost:${config.port}`);
  if (config.llm.provider === "mock") {
    console.log("No ANTHROPIC_API_KEY set - running with the offline mock model (demo mode).");
  } else {
    console.log(`Using ${config.llm.model} (effort: ${config.llm.effort})`);
  }
});

function shutdown() {
  server.close(() => {
    history.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
