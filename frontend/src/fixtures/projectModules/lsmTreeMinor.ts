import type { ModuleTask, ProjectModuleContent } from './types';
import { theoryForLanguage } from './theoryLanguage';

import theory from './minors/lsm-tree/memtable/theory.md?raw';

import goReadme from './minors/lsm-tree/memtable/go/files/README.md?raw';
import goMod from './minors/lsm-tree/memtable/go/files/go.mod?raw';
import goMakefile from './minors/lsm-tree/memtable/go/files/Makefile?raw';
import goMain from './minors/lsm-tree/memtable/go/files/cmd/lsmkv/main.go?raw';
import goSkiplist from './minors/lsm-tree/memtable/go/files/internal/memtable/skiplist.go?raw';
import goMemtable from './minors/lsm-tree/memtable/go/files/internal/memtable/memtable.go?raw';
import goIterator from './minors/lsm-tree/memtable/go/files/internal/memtable/iterator.go?raw';
import goTest from './minors/lsm-tree/memtable/go/files/internal/memtable/memtable_test.go?raw';

import pyReadme from './minors/lsm-tree/memtable/python/files/README.md?raw';
import pyMakefile from './minors/lsm-tree/memtable/python/files/Makefile?raw';
import pyPackageInit from './minors/lsm-tree/memtable/python/files/lsmkv/__init__.py?raw';
import pyMain from './minors/lsm-tree/memtable/python/files/lsmkv/__main__.py?raw';
import pyMemtableInit from './minors/lsm-tree/memtable/python/files/lsmkv/memtable/__init__.py?raw';
import pySkiplist from './minors/lsm-tree/memtable/python/files/lsmkv/memtable/skiplist.py?raw';
import pyMemtable from './minors/lsm-tree/memtable/python/files/lsmkv/memtable/memtable.py?raw';
import pyIterator from './minors/lsm-tree/memtable/python/files/lsmkv/memtable/iterator.py?raw';
import pyTest from './minors/lsm-tree/memtable/python/files/tests/test_memtable.py?raw';

import cppReadme from './minors/lsm-tree/memtable/cpp/files/README.md?raw';
import cppMakefile from './minors/lsm-tree/memtable/cpp/files/Makefile?raw';
import cppMain from './minors/lsm-tree/memtable/cpp/files/cmd/lsmkv/main.cc?raw';
import cppSkiplistH from './minors/lsm-tree/memtable/cpp/files/src/memtable/skiplist.h?raw';
import cppSkiplistCc from './minors/lsm-tree/memtable/cpp/files/src/memtable/skiplist.cc?raw';
import cppMemtableH from './minors/lsm-tree/memtable/cpp/files/src/memtable/memtable.h?raw';
import cppMemtableCc from './minors/lsm-tree/memtable/cpp/files/src/memtable/memtable.cc?raw';
import cppIteratorH from './minors/lsm-tree/memtable/cpp/files/src/memtable/iterator.h?raw';
import cppIteratorCc from './minors/lsm-tree/memtable/cpp/files/src/memtable/iterator.cc?raw';
import cppCheckH from './minors/lsm-tree/memtable/cpp/files/tests/check.h?raw';
import cppTest from './minors/lsm-tree/memtable/cpp/files/tests/memtable_test.cc?raw';

/** Same four tasks in every language; only the files and names differ. */
function memtableTasks(files: { skiplist: string; memtable: string; iterator: string }, names: {
  search: string;
  put: string;
  deleteGet: string;
  seekNext: string;
}): ModuleTask[] {
  return [
    {
      id: '1.1',
      label: 'Search the express lanes',
      file: files.skiplist,
      summary: `${names.search}: walk right, drop down, and record the last node before the key on every level.`,
    },
    {
      id: '1.2',
      label: 'Insert or overwrite',
      file: files.skiplist,
      summary: `${names.put}: overwrite an existing key in place, or splice a random-height tower into each level.`,
    },
    {
      id: '1.3',
      label: 'Tombstones and three-way get',
      file: files.memtable,
      summary: `${names.deleteGet}: a delete writes a tombstone; a lookup answers found, deleted, or missing.`,
    },
    {
      id: '1.4',
      label: 'Ordered iteration',
      file: files.iterator,
      summary: `${names.seekNext}: seek to the first key >= target, then step along level 0.`,
    },
  ];
}

export const LSM_TREE_MEMTABLE_GO: ProjectModuleContent = {
  projectId: 'lsm-tree',
  moduleId: 'memtable',
  language: 'go',
  theory: theoryForLanguage(theory, 'go'),
  entryFile: 'internal/memtable/skiplist.go',
  files: {
    'README.md': goReadme,
    'go.mod': goMod,
    Makefile: goMakefile,
    'cmd/lsmkv/main.go': goMain,
    'internal/memtable/skiplist.go': goSkiplist,
    'internal/memtable/memtable.go': goMemtable,
    'internal/memtable/iterator.go': goIterator,
    'internal/memtable/memtable_test.go': goTest,
  },
  tasks: memtableTasks(
    {
      skiplist: 'internal/memtable/skiplist.go',
      memtable: 'internal/memtable/memtable.go',
      iterator: 'internal/memtable/iterator.go',
    },
    { search: 'findGreaterOrEqual', put: 'put', deleteGet: 'Delete and Get', seekNext: 'Seek and Next' },
  ),
  verify: ['make test', 'make race', 'make run'],
};

export const LSM_TREE_MEMTABLE_PYTHON: ProjectModuleContent = {
  projectId: 'lsm-tree',
  moduleId: 'memtable',
  language: 'python',
  theory: theoryForLanguage(theory, 'python'),
  entryFile: 'lsmkv/memtable/skiplist.py',
  files: {
    'README.md': pyReadme,
    Makefile: pyMakefile,
    'lsmkv/__init__.py': pyPackageInit,
    'lsmkv/__main__.py': pyMain,
    'lsmkv/memtable/__init__.py': pyMemtableInit,
    'lsmkv/memtable/skiplist.py': pySkiplist,
    'lsmkv/memtable/memtable.py': pyMemtable,
    'lsmkv/memtable/iterator.py': pyIterator,
    'tests/test_memtable.py': pyTest,
  },
  tasks: memtableTasks(
    {
      skiplist: 'lsmkv/memtable/skiplist.py',
      memtable: 'lsmkv/memtable/memtable.py',
      iterator: 'lsmkv/memtable/iterator.py',
    },
    { search: 'find_greater_or_equal', put: 'put', deleteGet: 'delete and get', seekNext: 'seek and next' },
  ),
  verify: ['make test', 'make run'],
};

export const LSM_TREE_MEMTABLE_CPP: ProjectModuleContent = {
  projectId: 'lsm-tree',
  moduleId: 'memtable',
  language: 'cpp',
  theory: theoryForLanguage(theory, 'cpp'),
  entryFile: 'src/memtable/skiplist.cc',
  files: {
    'README.md': cppReadme,
    Makefile: cppMakefile,
    'cmd/lsmkv/main.cc': cppMain,
    'src/memtable/skiplist.h': cppSkiplistH,
    'src/memtable/skiplist.cc': cppSkiplistCc,
    'src/memtable/memtable.h': cppMemtableH,
    'src/memtable/memtable.cc': cppMemtableCc,
    'src/memtable/iterator.h': cppIteratorH,
    'src/memtable/iterator.cc': cppIteratorCc,
    'tests/check.h': cppCheckH,
    'tests/memtable_test.cc': cppTest,
  },
  tasks: memtableTasks(
    {
      skiplist: 'src/memtable/skiplist.cc',
      memtable: 'src/memtable/memtable.cc',
      iterator: 'src/memtable/iterator.cc',
    },
    { search: 'FindGreaterOrEqual', put: 'Put', deleteGet: 'Delete and Get', seekNext: 'Seek and Next' },
  ),
  verify: ['make test', 'make asan', 'make run'],
};
