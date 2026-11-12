/**
 * Validates the hand-written OpenAPI spec and proves openapi/generated.d.ts is
 * up to date. Runs in the phase gate so the typed client cannot drift.
 */
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "..");
const specPath = resolve(root, "openapi/openapi.yaml");
const generatedPath = resolve(root, "openapi/generated.d.ts");
const tempPath = resolve(root, "openapi/.generated.check.d.ts");

const spec = parse(await readFile(specPath, "utf8")) as {
  openapi?: string;
  info?: { version?: string };
  paths?: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, unknown> };
};

const problems: string[] = [];

if (!spec.openapi?.startsWith("3.")) problems.push("openapi must be 3.x");
if (spec.info?.version !== "1.0.0") problems.push("info.version must be 1.0.0");
if (!spec.components?.securitySchemes?.bearerAuth) problems.push("missing bearerAuth scheme");

const requiredPaths = [
  "/healthz",
  "/readyz",
  "/v1/links",
  "/v1/links/{slug}",
  "/v1/links/{slug}/analytics",
  "/v1/admin/backfill",
  "/{slug}",
];

for (const path of requiredPaths) {
  const item = spec.paths?.[path];
  if (!item) {
    problems.push(`missing path ${path}`);
    continue;
  }
  if (path.startsWith("/v1/") && path !== "/v1/admin/backfill") {
    for (const method of ["get", "post", "patch", "delete"] as const) {
      const operation = item[method] as { responses?: Record<string, unknown> } | undefined;
      if (operation && !operation.responses?.["401"] && path !== "/v1/links/{slug}/analytics") {
        problems.push(`${method.toUpperCase()} ${path} is missing a 401 response`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`OpenAPI validation failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/openapi-typescript/bin/cli.js"),
      "openapi/openapi.yaml",
      "-o",
      tempPath,
    ],
    { cwd: root, stdio: "pipe" },
  );
  const [checkedIn, fresh] = await Promise.all([
    readFile(generatedPath, "utf8"),
    readFile(tempPath, "utf8"),
  ]);
  if (checkedIn !== fresh) {
    console.error("openapi/generated.d.ts is stale; run pnpm openapi:types");
    process.exit(1);
  }
} finally {
  await rm(tempPath, { force: true });
}

console.log("OpenAPI spec valid; generated types are current.");
