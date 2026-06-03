import SandboxWorkspace from './SandboxWorkspace.jsx';

/** Review sandbox — same layout as Play (brief + metrics + terminal/editor/browser). */
export default function ReviewSandboxWorkspace(props) {
  return <SandboxWorkspace mode="review" {...props} />;
}
