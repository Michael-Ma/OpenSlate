// No native binary or provider: a parent-controlled fake startup clock.
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const pending = [];
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
lines.on("close", () => process.exit(0));
lines.on("line", line => {
  const message = JSON.parse(line);
  if (message.method === "fixture/release") {
    const original = pending.shift();
    if (original) send(message.error ? { id: original.id, error: message.error } : { id: original.id, result: { prepared: true } });
  } else if (message.id !== undefined) {
    pending.push(message);
    send({ method: "fixture/waiting", params: { method: message.method } });
  }
});
