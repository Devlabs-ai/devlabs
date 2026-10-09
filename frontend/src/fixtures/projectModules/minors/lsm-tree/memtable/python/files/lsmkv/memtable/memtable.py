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
        # ── TODO(1.3) — a delete is a write ──────────────────────────────────
        #
        # Do not remove the node. Older SSTables on disk may still hold a
        # value for key, and removing it here would let that old value
        # reappear.
        #
        # Copy key with bytes(key) (like put does), take the lock, and store
        # a tombstone: self._list.put(k, None, Kind.TOMBSTONE)
        raise NotImplementedError("TODO(1.3): delete — write a tombstone instead of removing the key")

    def get(self, key: bytes) -> Tuple[Optional[bytes], Result]:
        """Look key up in this memtable only.

        The value is returned only when the result is FOUND.
        """
        # ── TODO(1.3) — three answers, not two ───────────────────────────────
        #
        # Take the lock and self._list.get(key).
        #   no node                     -> (None, Result.MISSING)
        #   node.kind is Kind.TOMBSTONE -> (None, Result.DELETED)
        #   otherwise                   -> (node.value, Result.FOUND)
        #
        # MISSING and DELETED look alike to a user ("no value") but mean
        # opposite things to the read path in chapter 4: MISSING keeps
        # searching older tables, DELETED stops.
        raise NotImplementedError("TODO(1.3): get — report FOUND, DELETED, or MISSING")

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
