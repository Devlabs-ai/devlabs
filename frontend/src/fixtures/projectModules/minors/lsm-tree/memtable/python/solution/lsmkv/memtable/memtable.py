"""The in-memory, sorted write buffer of the LSM tree.

Every put and delete lands here first. When it grows past a size limit it is
frozen and flushed to disk as an SSTable (chapter 3), and a fresh memtable
takes its place.
"""

from __future__ import annotations

import threading
from enum import Enum
from typing import Optional, Tuple

from .iterator import Iterator
from .skiplist import Kind, SkipList


class Result(Enum):
    """The outcome of a lookup in one memtable."""

    # This memtable knows nothing about the key. Older tables might.
    MISSING = 0
    # The key has a live value here.
    FOUND = 1
    # The newest thing written for the key is a tombstone. The key is gone;
    # do not look in older tables.
    DELETED = 2


class Memtable:
    """A sorted, in-memory map.

    Python's standard library has no read/write lock, so one lock guards
    both reads and writes.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._list = SkipList(0x5EED)

    def put(self, key: bytes, value: bytes) -> None:
        """Store value under key, replacing anything written for key before.

        bytes() copies a bytearray, so callers may reuse their buffers.
        """
        k, v = bytes(key), bytes(value)
        with self._lock:
            self._list.put(k, v, Kind.VALUE)

    def delete(self, key: bytes) -> None:
        """Record that key no longer exists."""
        k = bytes(key)
        with self._lock:
            self._list.put(k, None, Kind.TOMBSTONE)

    def get(self, key: bytes) -> Tuple[Optional[bytes], Result]:
        """Look key up in this memtable only.

        The value is returned only when the result is FOUND.
        """
        with self._lock:
            n = self._list.get(key)
        if n is None:
            return None, Result.MISSING
        if n.kind is Kind.TOMBSTONE:
            return None, Result.DELETED
        return n.value, Result.FOUND

    def __len__(self) -> int:
        """Number of entries, tombstones included."""
        with self._lock:
            return self._list.length

    def approximate_size(self) -> int:
        """Memory the entries account for, in bytes."""
        with self._lock:
            return self._list.size

    def new_iterator(self) -> Iterator:
        """An iterator that is not positioned yet. Call seek_to_first or seek."""
        return Iterator(self._list)
