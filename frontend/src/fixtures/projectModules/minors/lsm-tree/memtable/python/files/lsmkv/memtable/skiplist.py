"""The sorted structure under the memtable."""

from __future__ import annotations

import random
from enum import Enum
from typing import Optional

# How many express lanes a node can join. With BRANCHING 4, 12 levels
# comfortably index 4**12 (~16M) entries.
MAX_HEIGHT = 12
# On average one node in four is promoted one level up.
BRANCHING = 4
# Approximate per-entry bookkeeping beyond the key and value bytes.
# Chapter 3 flushes when the total crosses a limit.
NODE_OVERHEAD = 32


class Kind(Enum):
    """What an entry means."""

    VALUE = 1
    # A deleted key. Older tables may still hold a value for it, so the
    # marker has to be stored, not the key removed.
    TOMBSTONE = 2


class Node:
    __slots__ = ("key", "value", "kind", "next")

    def __init__(self, key: bytes, value: Optional[bytes], kind: Optional[Kind], height: int):
        self.key = key
        self.value = value
        self.kind = kind
        # next[i] is this node's successor on level i. len(next) is its height.
        self.next: list[Optional[Node]] = [None] * height


def entry_size(key: bytes, value: Optional[bytes]) -> int:
    return len(key) + len(value or b"") + NODE_OVERHEAD


class SkipList:
    """A sorted map from key to (value, kind).

    Not thread-safe; Memtable serializes access to it.
    """

    def __init__(self, seed: int):
        # Sentinel with no key and a full-height tower.
        self.head = Node(b"", None, None, MAX_HEIGHT)
        # Tallest tower currently in the list (at least 1).
        self.height = 1
        self.length = 0
        self.size = 0
        self._rnd = random.Random(seed)
        # Counts key comparisons made by _less. Tests read it to check that
        # search uses the upper levels instead of crawling level 0.
        self.compares = 0

    def _less(self, a: bytes, b: bytes) -> bool:
        self.compares += 1
        return a < b

    def random_height(self) -> int:
        """1 with probability 3/4, 2 with 3/16, 3 with 3/64, ..."""
        h = 1
        while h < MAX_HEIGHT and self._rnd.randrange(BRANCHING) == 0:
            h += 1
        return h

    def find_greater_or_equal(self, key: bytes, prev: Optional[list] = None) -> Optional[Node]:
        """Return the first node whose key is >= key, or None.

        If prev is given (a list of length MAX_HEIGHT), prev[i] is set to the
        last node on level i whose key is < key: the node a new entry would be
        spliced after.
        """
        # ── TODO(1.1) — walk the express lanes ──────────────────────────────
        #
        # x = self.head
        # for level from self.height - 1 down to 0:
        #     while x.next[level] is not None and self._less(x.next[level].key, key):
        #         x = x.next[level]          # move right on this lane
        #     if prev is not None:
        #         prev[level] = x            # last node before key on this lane
        #     # then drop one level down and keep going from x
        # return x.next[0]
        #
        # Never restart from the head on a lower level. Dropping down from
        # where you are is what makes search O(log n) instead of O(n).
        raise NotImplementedError("TODO(1.1): find_greater_or_equal — walk right, drop down, record prev")

    def get(self, key: bytes) -> Optional[Node]:
        """Return the node holding key, or None."""
        n = self.find_greater_or_equal(key)
        if n is not None and n.key == key:
            return n
        return None

    def put(self, key: bytes, value: Optional[bytes], kind: Kind) -> None:
        """Insert key or overwrite its existing entry."""
        # ── TODO(1.2) — overwrite or splice ─────────────────────────────────
        #
        # 1. prev = [None] * MAX_HEIGHT
        #    x = self.find_greater_or_equal(key, prev)
        #
        # 2. Same key already present (x is not None and x.key == key)?
        #    Overwrite x.value and x.kind in place, adjust self.size by the
        #    value-length difference, and return. Length does not change:
        #    one key, one entry. (A tombstone's value is None: length 0.)
        #
        # 3. New key: h = self.random_height(). If h > self.height, the levels
        #    in [self.height, h) had no towers yet, so their predecessor is
        #    self.head; set those prev entries and raise self.height.
        #
        # 4. n = Node(key, value, kind, h). For every level i < h:
        #    n.next[i] = prev[i].next[i]; prev[i].next[i] = n
        #
        # 5. self.length += 1 and self.size += entry_size(key, value)
        raise NotImplementedError("TODO(1.2): put — overwrite in place or splice a new tower")
