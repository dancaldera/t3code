import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function escapeTomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildManagedCodexConfig(input: {
  readonly baseUrl?: string;
  readonly apiKey?: string;
}): string {
  const lines = ['model_provider = "custom"', "", "[model_providers.custom]"];

  if (input.baseUrl) {
    lines.push(`base_url = "${escapeTomlString(input.baseUrl)}"`);
  }
  if (input.apiKey) {
    lines.push(`api_key = "${escapeTomlString(input.apiKey)}"`);
  }

  return `${lines.join("\n")}\n`;
}

export function resolveManagedCodexHomePath(stateDir?: string): string {
  const rootDir =
    stateDir?.trim() && stateDir.trim().length > 0
      ? stateDir.trim()
      : path.join(os.tmpdir(), "t3code");
  return path.join(rootDir, "provider-config", "codex-managed");
}

export function writeManagedCodexConfig(input: {
  readonly stateDir?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}): string {
  const managedHomePath = resolveManagedCodexHomePath(input.stateDir);
  fs.mkdirSync(managedHomePath, { recursive: true });
  fs.writeFileSync(
    path.join(managedHomePath, "config.toml"),
    buildManagedCodexConfig({
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    }),
    "utf8",
  );
  return managedHomePath;
}
