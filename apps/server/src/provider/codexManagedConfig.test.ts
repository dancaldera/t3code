import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildManagedCodexConfig,
  resolveManagedCodexHomePath,
  writeManagedCodexConfig,
} from "./codexManagedConfig";

const createdDirs = new Set<string>();

afterEach(() => {
  for (const dir of createdDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  createdDirs.clear();
});

describe("codexManagedConfig", () => {
  it("builds the minimal custom provider config", () => {
    const config = buildManagedCodexConfig({
      baseUrl: "https://proxy.example/v1",
      apiKey: "secret-key",
    });

    expect(config).toContain('model_provider = "custom"');
    expect(config).toContain("[model_providers.custom]");
    expect(config).toContain('base_url = "https://proxy.example/v1"');
    expect(config).toContain('api_key = "secret-key"');
  });

  it("writes the managed config under the state directory", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-codex-managed-"));
    createdDirs.add(stateDir);

    const managedHomePath = writeManagedCodexConfig({
      stateDir,
      baseUrl: "https://proxy.example/v1",
      apiKey: "secret-key",
    });

    expect(managedHomePath).toBe(resolveManagedCodexHomePath(stateDir));
    expect(fs.readFileSync(path.join(managedHomePath, "config.toml"), "utf8")).toContain(
      'model_provider = "custom"',
    );
  });
});
