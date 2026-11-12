import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_TOKEN: "test-admin-token",
          IP_HASH_SALT: "test-ip-hash-salt",
          RATE_LIMIT_PER_MIN: "60",
          RATE_LIMIT_BURST: "30",
          ENVIRONMENT: "test",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    fileParallelism: false,
  },
});
