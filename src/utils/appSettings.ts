const STORAGE_KEY = 'jsdecloak.settings.v1';

/** Default = warm workbench from `@theme`; light/dark override via `data-app-theme`. */
export type AppTheme = 'default' | 'light' | 'dark';

export const APP_THEMES: readonly { id: AppTheme; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export interface AppSettings {
  autosaveEnabled: boolean;
  theme: AppTheme;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autosaveEnabled: true,
  theme: 'default',
};

const THEME_IDS = new Set<string>(APP_THEMES.map((t) => t.id));

/** Old palette ids → new three-way theme (best-effort migration). */
const LEGACY_THEMES: Record<string, AppTheme> = {
  bone: 'default',
  paper: 'light',
  slate: 'dark',
  midnight: 'dark',
  forest: 'dark',
  ocean: 'dark',
  ember: 'dark',
};

function isAppTheme(v: unknown): v is AppTheme {
  return typeof v === 'string' && THEME_IDS.has(v);
}

function coerceTheme(v: unknown): AppTheme {
  if (isAppTheme(v)) return v;
  if (typeof v === 'string' && v in LEGACY_THEMES) return LEGACY_THEMES[v]!;
  return DEFAULT_APP_SETTINGS.theme;
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    const p = JSON.parse(raw) as Partial<AppSettings & { renameKey?: unknown }>;
    return {
      autosaveEnabled: typeof p.autosaveEnabled === 'boolean' ? p.autosaveEnabled : DEFAULT_APP_SETTINGS.autosaveEnabled,
      theme: coerceTheme(p.theme),
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function persistAppSettings(next: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}
