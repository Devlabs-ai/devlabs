/** Authored content for one project module: the theory panel and the repo. */

export interface ModuleTask {
  /** Matches the TODO marker in the starter code, e.g. "1.2". */
  id: string;
  label: string;
  /** Path of the file the block lives in, as shown in the tree. */
  file: string;
  summary: string;
}

export interface ProjectModuleContent {
  projectId: string;
  moduleId: string;
  /** Markdown rendered in the left panel. */
  theory: string;
  /** The full starter repo: path -> contents. */
  files: Record<string, string>;
  /** File opened when the workspace mounts. */
  entryFile: string;
  tasks: ModuleTask[];
  /** Commands that prove the module is done. */
  verify: string[];
}
