package memtable

// Iterator walks a memtable in ascending key order, tombstones included.
//
// It takes no lock. Iterate a memtable that is no longer being written to
// (chapter 3 flushes frozen memtables) or from the writer's own goroutine.
type Iterator struct {
	list *skiplist
	node *node
}

// NewIterator returns an iterator that is not positioned yet. Call SeekToFirst
// or Seek before reading from it.
func (m *Memtable) NewIterator() *Iterator {
	return &Iterator{list: m.list}
}

// Valid reports whether the iterator is positioned on an entry.
func (it *Iterator) Valid() bool { return it.node != nil }

// Key of the current entry. Only call when Valid.
func (it *Iterator) Key() []byte { return it.node.key }

// Value of the current entry; nil for tombstones. Only call when Valid.
func (it *Iterator) Value() []byte { return it.node.value }

// Kind of the current entry. Only call when Valid.
func (it *Iterator) Kind() Kind { return it.node.kind }

// SeekToFirst positions the iterator on the smallest key.
func (it *Iterator) SeekToFirst() {
	it.node = it.list.head.next[0]
}

// Seek positions the iterator on the first key >= target.
func (it *Iterator) Seek(target []byte) {
	it.node = it.list.findGreaterOrEqual(target, nil)
}

// Next moves to the following key. Only call when Valid.
func (it *Iterator) Next() {
	it.node = it.node.next[0]
}
