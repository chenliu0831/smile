/**
 * Runtime validation helpers over the contract schemas. Uses TypeBox's own `Value` checker
 * (no Ajv dependency) so the validator and the types come from ONE library.
 *
 * Intended use:
 *  - DEV AID on the Webview: `assertValidInDev(DaemonMessage, frame, "ws")` logs a warning
 *    when a daemon frame doesn't match the schema. It NEVER throws in production — a trusted
 *    loopback daemon adding a field must not break an older Webview (forward-compat).
 *  - TESTS: `validate(schema, value)` returns structured errors for the golden-frame corpus
 *    and cross-language conformance assertions.
 */
import { Value, type ValueError } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

export interface ValidationResult {
  valid: boolean;
  errors: ValueError[];
}

/** Validate `value` against `schema`; returns all errors (empty when valid). */
export function validate(schema: TSchema, value: unknown): ValidationResult {
  const errors = [...Value.Errors(schema, value)];
  return { valid: errors.length === 0, errors };
}

/** True iff `value` matches `schema`. */
export function isValid(schema: TSchema, value: unknown): boolean {
  return Value.Check(schema, value);
}

/** Compact, human-readable rendering of the first N errors (for logs / test output). */
export function formatErrors(errors: ValueError[], limit = 5): string {
  return errors
    .slice(0, limit)
    .map((e) => `  at ${e.path || "/"}: ${e.message}`)
    .join("\n");
}

/**
 * Dev-only soft assertion. Logs a warning on mismatch; returns the value unchanged so it is
 * a transparent pass-through at call sites. No-op outside dev (guarded by `enabled`).
 *
 * @param enabled gate (default: import.meta.env?.DEV when available, else false).
 */
export function assertValidInDev<T>(
  schema: TSchema,
  value: T,
  label: string,
  enabled: boolean = devDefault(),
): T {
  if (!enabled) return value;
  const { valid, errors } = validate(schema, value);
  if (!valid) {
    // eslint-disable-next-line no-console
    console.warn(
      `[contract] ${label} frame does not match schema (${errors.length} error(s)):\n${formatErrors(errors)}`,
    );
  }
  return value;
}

/** Best-effort dev detection across Vite (import.meta.env.DEV) and Node (NODE_ENV). */
function devDefault(): boolean {
  // Vite injects import.meta.env; read it defensively so this compiles in both the app's
  // Vite tsconfig (where the field is typed) and the contract's plain tsconfig (where it
  // isn't). Cast through unknown to avoid depending on Vite's ImportMeta augmentation.
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  if (meta && meta.env && typeof meta.env.DEV === "boolean") return meta.env.DEV;
  if (typeof process !== "undefined" && process.env) {
    return process.env.NODE_ENV !== "production";
  }
  return false;
}
