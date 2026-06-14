import type { WebSocket } from 'ws';
import type { IPty } from 'node-pty';

export type { WebSocket, IPty };

/** Minimal WebSocket surface used by observability handlers. */
export type ObservabilityWebSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'on'> & {
  OPEN: number;
};

export function asObservabilityWebSocket(ws: WebSocket): ObservabilityWebSocket {
  return ws as ObservabilityWebSocket;
}
