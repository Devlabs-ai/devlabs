import type { ProjectModuleContent } from './types';

import theory from './cinder/event-loop/theory.md?raw';
import readme from './cinder/event-loop/files/README.md?raw';
import makefile from './cinder/event-loop/files/Makefile?raw';
import goMod from './cinder/event-loop/files/go.mod?raw';
import goSum from './cinder/event-loop/files/go.sum?raw';
import kindGo from './cinder/event-loop/files/internal/eventloop/kind.go?raw';
import pollerGo from './cinder/event-loop/files/internal/eventloop/poller.go?raw';
import pollerLinuxGo from './cinder/event-loop/files/internal/eventloop/poller_linux.go?raw';
import pollerDarwinGo from './cinder/event-loop/files/internal/eventloop/poller_darwin.go?raw';
import loopGo from './cinder/event-loop/files/internal/eventloop/loop.go?raw';
import loopTestGo from './cinder/event-loop/files/internal/eventloop/loop_test.go?raw';
import serverGo from './cinder/event-loop/files/internal/server/server.go?raw';
import mainGo from './cinder/event-loop/files/cmd/cinder/main.go?raw';

export const CINDER_EVENT_LOOP: ProjectModuleContent = {
  projectId: 'cinder',
  moduleId: 'event-loop',
  theory,
  entryFile: 'internal/eventloop/loop.go',
  files: {
    'README.md': readme,
    'go.mod': goMod,
    'go.sum': goSum,
    Makefile: makefile,
    'cmd/cinder/main.go': mainGo,
    'internal/eventloop/kind.go': kindGo,
    'internal/eventloop/poller.go': pollerGo,
    'internal/eventloop/poller_linux.go': pollerLinuxGo,
    'internal/eventloop/poller_darwin.go': pollerDarwinGo,
    'internal/eventloop/loop.go': loopGo,
    'internal/eventloop/loop_test.go': loopTestGo,
    'internal/server/server.go': serverGo,
  },
  tasks: [
    {
      id: '1.1',
      label: 'Register the fd',
      file: 'internal/eventloop/loop.go',
      summary: 'Set O_NONBLOCK, then add the descriptor to the poller.',
    },
    {
      id: '1.2',
      label: 'Run the loop',
      file: 'internal/eventloop/loop.go',
      summary: 'Wait, dispatch writable then readable, survive EINTR, stop cleanly.',
    },
  ],
  verify: ['make test', 'make race', 'make run'],
};
