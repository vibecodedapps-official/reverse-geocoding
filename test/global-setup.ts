// Builds the synthetic fixture index into test/.build, where the Worker tests' .bin imports point.

import { join } from "node:path";
import { buildSynthetic } from "./helpers/synthetic.ts";

export default function setup(): void {
  buildSynthetic(join(import.meta.dirname, ".build"));
}
