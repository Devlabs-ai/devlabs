"""Ordered walk over a memtable."""

from __future__ import annotations

from typing import Optional

from .skiplist import Kind, Node, SkipList


class Iterator:
    """Walks a memtable in ascending key order, tombstones included.

    It takes no lock. Iterate a memtable that is no longer being written to
    (chapter 3 flushes frozen memtables) or from the writer's own thread.
    """

    def __init__(self, skiplist: SkipList):
        self._list = skiplist
        self._node: Optional[Node] = None

    def valid(self) -> bool:
        """Whether the iterator is positioned on an entry."""
        return self._node is not None

    def key(self) -> bytes:
        return self._node.key

    def value(self) -> Optional[bytes]:
        """None for tombstones."""
        return self._node.value

    def kind(self) -> Kind:
        return self._node.kind

    def seek_to_first(self) -> None:
        """Position on the smallest key."""
        self._node = self._list.head.next[0]

    def seek(self, target: bytes) -> None:
        """Position on the first key >= target."""
        self._node = self._list.find_greater_or_equal(target)

    def next(self) -> None:
        """Move to the following key. Only call when valid()."""
        self._node = self._node.next[0]
