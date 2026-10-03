import { homedir } from "node:os";
import { hatchPath as hatchPathIn, noddConfigPath as noddConfigPathIn } from "./config-core.ts";

export {
  DEFAULT_CONFIG,
  mergeConfig,
  parseConfig,
  type GateFlag,
  type NoddConfig,
  type ParsedConfig,
} from "./config-core.ts";

export function noddConfigPath(home: string = homedir()): string {
  return noddConfigPathIn(home);
}

export function hatchPath(home: string = homedir()): string {
  return hatchPathIn(home);
}
