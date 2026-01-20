/**
 * CLI argument parsing utilities.
 */

export interface ParseArgsOptions {
  /** When true, don't coerce values - keep everything as strings */
  rawStrings?: boolean;
}

/**
 * Parses command-line arguments into a key-value object.
 * Supports both --flag=value and --flag value syntax.
 *
 * @param argv - Array of command-line arguments
 * @param options - Parsing options
 * @returns Object with parsed key-value pairs
 */
export function parseArgs(argv: string[], options?: ParseArgsOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const transform = options?.rawStrings ? (v: string) => v : coerceValue;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Handle short flags like -h (only exact match, not -tag:foo which is a value)
    if (arg === "-h") {
      out["h"] = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1);
      out[key] = transform(val);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // Values starting with single dash (like -tag:foo) are valid values, not flags
      if (next && !next.startsWith("--")) {
        out[key] = transform(next);
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

/**
 * Coerces string values to appropriate types.
 * Converts "true"/"false" to booleans and numeric strings to numbers.
 */
function coerceValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!Number.isNaN(num) && val.trim() !== "") return num;
  return val;
}
