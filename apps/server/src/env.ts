import path from "node:path";
import { config } from "dotenv";
import { repoRoot } from "./paths";

// .env.local tem precedência sobre .env
config({
  path: [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")],
});
