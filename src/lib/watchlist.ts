const IGNORED = new Set(
  [
    "idle",
    "system",
    "registry",
    "memory compression",
    "secure system",
    "smss",
    "csrss",
    "wininit",
    "winlogon",
    "services",
    "lsass",
    "lsm",
    "svchost",
    "fontdrvhost",
    "dwm",
    "ctfmon",
    "sihost",
    "taskhostw",
    "runtimebroker",
    "searchhost",
    "searchapp",
    "searchindexer",
    "startmenuexperiencehost",
    "shellexperiencehost",
    "applicationframehost",
    "systemsettings",
    "textinputhost",
    "securityhealthsystray",
    "securityhealthservice",
    "conhost",
    "dllhost",
    "wudfhost",
    "dashost",
    "wmiprvse",
    "unsecapp",
    "msmpeng",
    "nissrv",
    "aggregatorhost",
    "widgetservice",
    "phoneexperiencehost",
    "lockapp",
    "logonui",
    "userinit",
    "audiodg",
    "spoolsv",
    "smartscreen",
    "searchprotocolhost",
    "compattelrunner",
    "mousocoreworker",
    "backgroundtaskhost",
    "chxsmartscreen",
    "useroobebroker",
    "filecoauth",
    "sgrmbroker",
    "wmiapsrv",
  ].map((n) => n.toLowerCase()),
);

export const DEFAULT_WATCHLIST = [
  "chrome",
  "msedge",
  "firefox",
  "brave",
  "cursor",
  "code",
  "devenv",
  "idea64",
  "pycharm64",
  "webstorm64",
  "node",
  "bun",
  "deno",
  "python",
  "pythonw",
  "powershell",
  "pwsh",
  "cmd",
  "windowsterminal",
  "windowsterminal.exe",
  "discord",
  "slack",
  "teams",
  "ms-teams",
  "spotify",
  "steam",
  "steamwebhelper",
  "docker",
  "com.docker.backend",
  "rustc",
  "cargo",
  "git",
  "githubdesktop",
  "figma",
  "notion",
  "obsidian",
  "warp",
  "alacritty",
  "wezterm-gui",
  "vlc",
  "photoshop",
  "afterfx",
  "premiere",
  "excel",
  "winword",
  "powerpnt",
  "outlook",
  "thunderbird",
  "zoom",
  "obs64",
  "obs",
].map((n) => n.toLowerCase());

export const BUILD_PROCESSES = new Set(
  [
    "node",
    "bun",
    "deno",
    "cargo",
    "rustc",
    "msbuild",
    "dotnet",
    "tsc",
    "webpack",
    "vite",
    "esbuild",
    "python",
    "pythonw",
    "go",
    "javac",
    "gradle",
    "mvn",
  ].map((n) => n.toLowerCase()),
);

export const CRASH_REPORTERS = new Set(
  ["werfault", "werfaultsecure", "crashpad_handler", "fct_id"].map((n) =>
    n.toLowerCase(),
  ),
);

export function normalizeName(name: string): string {
  return name.replace(/\.exe$/i, "").trim().toLowerCase();
}

export function isIgnored(name: string): boolean {
  return IGNORED.has(normalizeName(name));
}

export function isWatched(
  name: string,
  extraWatchlist: string[],
  includeBackground: boolean,
  workingSet = 0,
): boolean {
  const n = normalizeName(name);
  if (isIgnored(n)) return false;
  if (includeBackground) return true;
  if (DEFAULT_WATCHLIST.includes(n)) return true;
  if (extraWatchlist.some((item) => normalizeName(item) === n)) return true;
  return workingSet >= 80 * 1024 * 1024;
}

export function isBuildProcess(name: string): boolean {
  return BUILD_PROCESSES.has(normalizeName(name));
}

export function isCrashReporter(name: string): boolean {
  return CRASH_REPORTERS.has(normalizeName(name));
}

export function displayName(name: string): string {
  const n = name.replace(/\.exe$/i, "").trim();
  if (!n) return "unknown";
  return n;
}
