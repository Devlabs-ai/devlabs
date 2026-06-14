export function openMetricsSocket(
  url: string,
  { onMessage, onError, onClose }: {
    onMessage?: (msg: unknown) => void;
    onError?: (event: Event) => void;
    onClose?: (event: CloseEvent) => void;
  } = {},
) {
  const ws = new WebSocket(url);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      onMessage && onMessage(msg);
    } catch (_e) {
      // ignore malformed frame
    }
  };
  ws.onerror = (e) => onError && onError(e);
  ws.onclose = (e) => onClose && onClose(e);
  return ws;
}
