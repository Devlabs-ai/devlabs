/** Minors — small independent builds. A major may point at one; the reverse is not required. */

export const MINORS_PATH = '/play/minors';

export interface MinorEntry {
  id: string;
  name: string;
  subtitle: string;
  blurb: string;
  about: string[];
  language: string;
  facts: string[];
  status: 'ready' | 'planned';
}

export const MINORS: MinorEntry[] = [
  {
    id: 'tcp-server',
    name: 'TCP server',
    subtitle: 'Accept connections and speak a line protocol',
    blurb:
      'Bind a listener, accept clients, and serve a line protocol with one goroutine per connection. By the end you have a process you can talk to with nc.',
    about: [
      'A TCP server is a listening socket, an accept loop, and a connection handler that reads requests and writes replies. By the end you have a process that answers PING over the network.',
      'You implement listen, accept, the per-connection read loop, and graceful shutdown. The protocol is one request per line: PING, ECHO, QUIT. Tests dial a real port — passing them means the socket path actually works.',
    ],
    language: 'Go',
    facts: ['Sockets', 'Accept loop', 'Line protocol'],
    status: 'ready',
  },
];

export function getMinor(id: string | null | undefined): MinorEntry | null {
  if (!id) return null;
  return MINORS.find((m) => m.id === id) || null;
}

export function minorsFor(ids: string[] | undefined): MinorEntry[] {
  if (!ids || ids.length === 0) return [];
  return ids.map((id) => getMinor(id)).filter((m): m is MinorEntry => m != null);
}
