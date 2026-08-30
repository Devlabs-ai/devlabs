import type { ProjectModuleContent } from './types';

import theory from './cinder/event-loop/theory.md?raw';
import readme from './cinder/event-loop/files/README.md?raw';
import makefile from './cinder/event-loop/files/Makefile?raw';
import mainGo from './cinder/event-loop/files/main.go?raw';
import configGo from './cinder/event-loop/files/config.go?raw';
import lineGo from './cinder/event-loop/files/line.go?raw';
import pollerGo from './cinder/event-loop/files/poller.go?raw';
import pollerLinuxGo from './cinder/event-loop/files/poller_linux.go?raw';
import pollerDarwinGo from './cinder/event-loop/files/poller_darwin.go?raw';
import loopGo from './cinder/event-loop/files/loop.go?raw';
import loopTestGo from './cinder/event-loop/files/loop_test.go?raw';
import serverGo from './cinder/event-loop/files/server.go?raw';
import connGo from './cinder/event-loop/files/conn.go?raw';
import serverTestGo from './cinder/event-loop/files/server_test.go?raw';

import goMod from './cinder/event-loop/files/go.mod?raw';
import logxGo from './cinder/event-loop/files/logx.go?raw';
import smokeSh from './cinder/event-loop/files/smoke.sh?raw';

export const CINDER_EVENT_LOOP: ProjectModuleContent = {
  projectId: 'cinder',
  moduleId: 'event-loop',
  theory,
  entryFile: 'internal/evloop/loop.go',
  files: {
    'README.md': readme,
    'go.mod': goMod,
    Makefile: makefile,
    'cmd/cinder/main.go': mainGo,
    'internal/config/config.go': configGo,
    'internal/logx/logx.go': logxGo,
    'internal/proto/line.go': lineGo,
    'internal/evloop/poller.go': pollerGo,
    'internal/evloop/poller_linux.go': pollerLinuxGo,
    'internal/evloop/poller_darwin.go': pollerDarwinGo,
    'internal/evloop/loop.go': loopGo,
    'internal/evloop/loop_test.go': loopTestGo,
    'internal/server/server.go': serverGo,
    'internal/server/conn.go': connGo,
    'internal/server/server_test.go': serverTestGo,
    'scripts/smoke.sh': smokeSh,
  },
  tasks: [
    {
      id: '2.1',
      label: 'Put the fd under the loop',
      file: 'internal/evloop/loop.go',
      summary: 'Switch the descriptor to non-blocking, then add it to the poller.',
    },
    {
      id: '2.2',
      label: 'The event loop',
      file: 'internal/evloop/loop.go',
      summary: 'Wait for readiness, dispatch writable before readable, survive EINTR, stop cleanly.',
    },
    {
      id: '2.3',
      label: 'Drain the accept queue',
      file: 'internal/server/server.go',
      summary: 'Accept until EAGAIN, tune and register each client, refuse gracefully at the fd limit.',
    },
    {
      id: '2.4',
      label: 'Read, frame, execute',
      file: 'internal/server/server.go',
      summary: 'Read until EAGAIN into the connection buffer, run every complete frame, then flush.',
    },
  ],
  verify: ['make loop', 'make test', 'make race'],
};
