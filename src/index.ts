import { searchLocation } from "./utils/python_bridge.js";

async function main(): Promise<void> {
  const query = process.argv[2] ?? "Toronto Pearson Airport";
  const countryCodes = process.argv[3] ?? "ca";

  const response = await searchLocation(query, countryCodes);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
