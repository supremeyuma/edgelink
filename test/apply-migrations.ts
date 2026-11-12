import { applyD1Migrations, env } from "cloudflare:test";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS ?? []);
