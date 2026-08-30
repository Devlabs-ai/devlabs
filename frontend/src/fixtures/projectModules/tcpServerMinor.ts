import type { ProjectModuleContent } from './types';

import theory from './minors/tcp-server/theory.md?raw';
import readme from './minors/tcp-server/files/README.md?raw';
import goMod from './minors/tcp-server/files/go.mod?raw';
import makefile from './minors/tcp-server/files/Makefile?raw';
import mainGo from './minors/tcp-server/files/main.go?raw';
import configGo from './minors/tcp-server/files/config.go?raw';
import logxGo from './minors/tcp-server/files/logx.go?raw';
import lineGo from './minors/tcp-server/files/line.go?raw';
import serverGo from './minors/tcp-server/files/server.go?raw';
import connGo from './minors/tcp-server/files/conn.go?raw';
import serverTestGo from './minors/tcp-server/files/server_test.go?raw';
import smokeSh from './minors/tcp-server/files/smoke.sh?raw';

export const TCP_SERVER_MINOR: ProjectModuleContent = {
  projectId: 'minor',
  moduleId: 'tcp-server',
  theory,
  entryFile: 'server.go',
  files: {
    'README.md': readme,
    'go.mod': goMod,
    Makefile: makefile,
    'main.go': mainGo,
    'config.go': configGo,
    'logx.go': logxGo,
    'line.go': lineGo,
    'server.go': serverGo,
    'conn.go': connGo,
    'server_test.go': serverTestGo,
    'smoke.sh': smokeSh,
  },
  tasks: [
    {
      id: '1.1',
      label: 'Bind the listening socket',
      file: 'server.go',
      summary: 'net.Listen on the configured address and keep the listener under the mutex.',
    },
    {
      id: '1.2',
      label: 'The accept loop',
      file: 'server.go',
      summary: 'Accept forever, serve each connection on its own goroutine, exit cleanly on shutdown.',
    },
    {
      id: '1.3',
      label: 'The connection read loop',
      file: 'conn.go',
      summary: 'Deadline, read a framed line, parse, handle, write, flush — until the peer goes away.',
    },
    {
      id: '1.4',
      label: 'Graceful shutdown',
      file: 'server.go',
      summary: 'Stop accepting, close live connections, wait for handlers to return.',
    },
  ],
  verify: ['make test', 'make smoke', "printf 'PING\\r\\n' | nc 127.0.0.1 7400"],
};
