import { useCallback } from "react";
import { Option, Schema } from "effect";
import * as SchemaGetter from "effect/SchemaGetter";
import { TrimmedNonEmptyString, type ProviderKind } from "@t3tools/contracts";
import {
  getDefaultModel,
  getModelOptions,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { EnvMode } from "./components/BranchToolbar.logic";

export const APP_SETTINGS_STORAGE_KEY = "t3code:app-settings:v1";
const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export interface ProviderCustomModelConfig {
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
}

export const CustomModelEntrySchema = Schema.Struct({
  slug: Schema.String,
  runtime: Schema.Literals(["codex", "claudeAgent"]),
});
export type CustomModelEntry = typeof CustomModelEntrySchema.Type;

const BUILT_IN_MODEL_SLUGS_BY_PROVIDER: Record<ProviderKind, ReadonlySet<string>> = {
  codex: new Set(getModelOptions("codex").map((option) => option.slug)),
  claudeAgent: new Set(getModelOptions("claudeAgent").map((option) => option.slug)),
};

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

const CanonicalAppSettingsSchema = Schema.Struct({
  codexBinaryPath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexHomePath: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexBaseUrl: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  codexApiKey: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  claudeBaseUrl: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  claudeApiKey: Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  defaultThreadEnvMode: EnvMode.pipe(withDefaults(() => "local" as const satisfies EnvMode)),
  confirmThreadDelete: Schema.Boolean.pipe(withDefaults(() => true)),
  enableAssistantStreaming: Schema.Boolean.pipe(withDefaults(() => false)),
  timestampFormat: TimestampFormat.pipe(withDefaults(() => DEFAULT_TIMESTAMP_FORMAT)),
  customModels: Schema.Array(CustomModelEntrySchema).pipe(withDefaults(() => [])),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
});
export type AppSettings = typeof CanonicalAppSettingsSchema.Type;

const LegacyAppSettingsSchema = Schema.Struct({
  codexBinaryPath: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  ),
  codexHomePath: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  ),
  codexBaseUrl: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  ),
  codexApiKey: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  ),
  claudeBaseUrl: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  ),
  claudeApiKey: Schema.optional(
    Schema.String.check(Schema.isMaxLength(4096)).pipe(withDefaults(() => "")),
  ),
  defaultThreadEnvMode: Schema.optional(
    EnvMode.pipe(withDefaults(() => "local" as const satisfies EnvMode)),
  ),
  confirmThreadDelete: Schema.optional(Schema.Boolean.pipe(withDefaults(() => true))),
  enableAssistantStreaming: Schema.optional(Schema.Boolean.pipe(withDefaults(() => false))),
  timestampFormat: Schema.optional(
    TimestampFormat.pipe(withDefaults(() => DEFAULT_TIMESTAMP_FORMAT)),
  ),
  customModels: Schema.optional(Schema.Array(CustomModelEntrySchema).pipe(withDefaults(() => []))),
  customCodexModels: Schema.optional(Schema.Array(Schema.String).pipe(withDefaults(() => []))),
  customClaudeModels: Schema.optional(Schema.Array(Schema.String).pipe(withDefaults(() => []))),
  textGenerationModel: Schema.optional(TrimmedNonEmptyString),
});

export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const DEFAULT_APP_SETTINGS = CanonicalAppSettingsSchema.makeUnsafe({});

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    title: "Codex",
    description: "Save model slugs that should be available when using the Codex runtime.",
    placeholder: "your-codex-runtime-model",
    example: "glm-5",
  },
  claudeAgent: {
    provider: "claudeAgent",
    title: "Claude",
    description: "Save model slugs that should be available when using the Claude Code runtime.",
    placeholder: "your-claude-runtime-model",
    example: "glm-5",
  },
};
export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

function normalizeSettingsText(value: string): string {
  return value.trim();
}

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();
  const builtInModelSlugs = BUILT_IN_MODEL_SLUGS_BY_PROVIDER[provider];

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

function normalizeCustomModelEntries(
  entries: Iterable<CustomModelEntry | null | undefined>,
): CustomModelEntry[] {
  const nextEntries: CustomModelEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry) continue;
    const runtime = entry.runtime;
    if (runtime !== "codex" && runtime !== "claudeAgent") {
      continue;
    }
    for (const slug of normalizeCustomModelSlugs([entry.slug], runtime)) {
      const dedupeKey = `${runtime}:${slug}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      nextEntries.push({ slug, runtime });
    }
  }

  return nextEntries;
}

function normalizeLegacyAppSettings(input: typeof LegacyAppSettingsSchema.Type): AppSettings {
  const legacyCustomModels: CustomModelEntry[] = [];
  for (const slug of input.customCodexModels ?? []) {
    legacyCustomModels.push({ slug, runtime: "codex" });
  }
  for (const slug of input.customClaudeModels ?? []) {
    legacyCustomModels.push({ slug, runtime: "claudeAgent" });
  }

  return {
    codexBinaryPath: normalizeSettingsText(input.codexBinaryPath ?? ""),
    codexHomePath: normalizeSettingsText(input.codexHomePath ?? ""),
    codexBaseUrl: normalizeSettingsText(input.codexBaseUrl ?? ""),
    codexApiKey: normalizeSettingsText(input.codexApiKey ?? ""),
    claudeBaseUrl: normalizeSettingsText(input.claudeBaseUrl ?? ""),
    claudeApiKey: normalizeSettingsText(input.claudeApiKey ?? ""),
    defaultThreadEnvMode: input.defaultThreadEnvMode ?? "local",
    confirmThreadDelete: input.confirmThreadDelete ?? true,
    enableAssistantStreaming: input.enableAssistantStreaming ?? false,
    timestampFormat: input.timestampFormat ?? DEFAULT_TIMESTAMP_FORMAT,
    customModels: normalizeCustomModelEntries([
      ...(input.customModels ?? []),
      ...legacyCustomModels,
    ]),
    ...(input.textGenerationModel ? { textGenerationModel: input.textGenerationModel } : {}),
  };
}

const legacyToCanonical = (input: typeof LegacyAppSettingsSchema.Type): AppSettings =>
  normalizeLegacyAppSettings(input);

const canonicalToLegacy = (input: AppSettings): typeof LegacyAppSettingsSchema.Type => ({
  codexBinaryPath: input.codexBinaryPath,
  codexHomePath: input.codexHomePath,
  codexBaseUrl: input.codexBaseUrl,
  codexApiKey: input.codexApiKey,
  claudeBaseUrl: input.claudeBaseUrl,
  claudeApiKey: input.claudeApiKey,
  defaultThreadEnvMode: input.defaultThreadEnvMode,
  confirmThreadDelete: input.confirmThreadDelete,
  enableAssistantStreaming: input.enableAssistantStreaming,
  timestampFormat: input.timestampFormat,
  customModels: input.customModels,
  ...(input.textGenerationModel ? { textGenerationModel: input.textGenerationModel } : {}),
});

const appSettingsTransformation = {
  decode: SchemaGetter.transform(legacyToCanonical),
  encode: SchemaGetter.transform(canonicalToLegacy),
} as never;

export const AppSettingsSchema = LegacyAppSettingsSchema.pipe(
  Schema.decodeTo(CanonicalAppSettingsSchema, appSettingsTransformation),
);

export function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    codexBaseUrl: normalizeSettingsText(settings.codexBaseUrl),
    codexApiKey: normalizeSettingsText(settings.codexApiKey),
    claudeBaseUrl: normalizeSettingsText(settings.claudeBaseUrl),
    claudeApiKey: normalizeSettingsText(settings.claudeApiKey),
    customModels: normalizeCustomModelEntries(settings.customModels),
  };
}

export function getCustomModelsForProvider(
  settings: Pick<AppSettings, "customModels">,
  provider: ProviderKind,
): readonly string[] {
  return settings.customModels
    .filter((entry: CustomModelEntry) => entry.runtime === provider)
    .map((entry: CustomModelEntry) => entry.slug);
}

export function getDefaultCustomModelsForProvider(
  defaults: Pick<AppSettings, "customModels">,
  provider: ProviderKind,
): readonly string[] {
  return getCustomModelsForProvider(defaults, provider);
}

export function patchCustomModels(
  provider: ProviderKind,
  models: string[],
  existingEntries: readonly CustomModelEntry[] = [],
): Pick<AppSettings, "customModels"> {
  const preservedEntries = existingEntries.filter((entry) => entry.runtime !== provider);
  const nextEntries = [
    ...preservedEntries,
    ...normalizeCustomModelSlugs(models, provider).map(
      (slug) =>
        ({
          slug,
          runtime: provider,
        }) satisfies CustomModelEntry,
    ),
  ];
  return {
    customModels: normalizeCustomModelEntries(nextEntries),
  };
}

export function getCustomModelsByProvider(
  settings: Pick<AppSettings, "customModels">,
): Record<ProviderKind, readonly string[]> {
  return {
    codex: getCustomModelsForProvider(settings, "codex"),
    claudeAgent: getCustomModelsForProvider(settings, "claudeAgent"),
  };
}

export function getAppModelOptions(
  provider: ProviderKind,
  customModels: readonly string[],
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getModelOptions(provider).map(({ slug, name }) => ({
    slug,
    name,
    isCustom: false,
  }));
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();

  for (const slug of normalizeCustomModelSlugs(customModels, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  customModels: Record<ProviderKind, readonly string[]>,
  selectedModel: string | null | undefined,
): string {
  const customModelsForProvider = customModels[provider];
  const options = getAppModelOptions(provider, customModelsForProvider, selectedModel);
  return resolveSelectableModel(provider, selectedModel, options) ?? getDefaultModel(provider);
}

export function getCustomModelOptionsByProvider(
  settings: Pick<AppSettings, "customModels">,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  const customModelsByProvider = getCustomModelsByProvider(settings);
  return {
    codex: getAppModelOptions("codex", customModelsByProvider.codex),
    claudeAgent: getAppModelOptions("claudeAgent", customModelsByProvider.claudeAgent),
  };
}

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage(
    APP_SETTINGS_STORAGE_KEY,
    DEFAULT_APP_SETTINGS,
    AppSettingsSchema,
  );

  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => normalizeAppSettings({ ...prev, ...patch }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_APP_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    updateSettings,
    resetSettings,
    defaults: DEFAULT_APP_SETTINGS,
  } as const;
}
