export {};

declare global {
  interface Error {
    status?: number;
    raw?: unknown;
    rawText?: string | null;
    code?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    lastFailure?: string | null;
    lastAttempt?: import('./domain').BuildAttempt | null;
    availableCategories?: unknown;
    composeStdout?: string | null;
    composeStderr?: string | null;
    logs?: unknown;
  }
}
