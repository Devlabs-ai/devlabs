import type { K8sReadingSection } from '../../constants/k8sReadings';
import type { LanguageId } from '../../constants/languages';

/** A `reading` chapter: a blog-style article in the same shape as track readings. */
export interface ChapterReading {
  eyebrow: string;
  title: string;
  lede: string;
  sections: K8sReadingSection[];
  takeaways: string[];
  showBlogStamp?: boolean;
}

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
  /** Set on chapters authored in several languages; one content object per language. */
  language?: LanguageId;
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
