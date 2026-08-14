export interface BundledSkillInfo {
  id: string;
  name: string;
  description: string;
}

export interface InstalledPluginInfo {
  id: string;
  name: string;
  description: string;
  version?: string;
  skill_count: number;
  mcp_server_count: number;
  app_count: number;
  enabled: boolean;
}

export interface SkillPluginLoadError {
  root: string;
  message: string;
}

export interface SkillsPluginsCatalog {
  bundled_skills: BundledSkillInfo[];
  installed_plugins: InstalledPluginInfo[];
  errors: SkillPluginLoadError[];
}
