import { spawn } from "node:child_process";
import { once } from "node:events";

const host = "127.0.0.1";
const port = "4173";
const baseUrl = `http://${host}:${port}`;

const vite = spawn(
  process.execPath,
  ["./node_modules/vite/bin/vite.js", "preview", "--host", host, "--port", port],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }
);

let serverReady = false;

vite.stdout.on("data", (chunk) => process.stdout.write(chunk.toString()));
vite.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));

async function waitForServer() {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    if (vite.exitCode !== null || vite.signalCode !== null) {
      throw new Error(`Vite preview exited early with code ${vite.exitCode}`);
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        serverReady = true;
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Vite preview did not become ready at ${baseUrl}`);
}

async function stopServer() {
  if (vite.exitCode !== null || vite.signalCode !== null) {
    return;
  }

  vite.kill();
  await Promise.race([
    once(vite, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);
}

try {
  await waitForServer();

  const playwright = spawn(
    process.execPath,
    ["./node_modules/@playwright/test/cli.js", "test"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PLAYWRIGHT_BASE_URL: baseUrl },
      stdio: "inherit",
      windowsHide: true
    }
  );

  const [code] = await once(playwright, "exit");
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await stopServer();
}
