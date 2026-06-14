import SandboxWorkspace from './SandboxWorkspace';
import type { SandboxWorkspaceProps } from './SandboxWorkspace';

/** Review sandbox — same layout as Play (brief + metrics + terminal/editor/browser). */
export default function ReviewSandboxWorkspace(props: SandboxWorkspaceProps): JSX.Element | null {
  return SandboxWorkspace({ mode: 'review', ...props });
}
