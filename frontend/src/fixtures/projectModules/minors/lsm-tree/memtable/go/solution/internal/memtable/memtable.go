// Package memtable is the in-memory, sorted write buffer of the LSM tree.
//
// Every Put and Delete lands here first. When it grows past a size limit it is
// frozen and flushed to disk as an SSTable (chapter 3), and a fresh memtable
// takes its place.
package memtable

import "sync"

// Result is the outcome of a lookup in one memtable.
type Result uint8

const (
	// Missing: this memtable knows nothing about the key. Older tables might.
	Missing Result = iota
	// Found: the key has a live value here.
	Found
	// Deleted: the newest thing written for the key is a tombstone. The key
	// is gone; do not look in older tables.
	Deleted
)

func (r Result) String() string {
	switch r {
	case Missing:
		return "missing"
	case Found:
		return "found"
	case Deleted:
		return "deleted"
	default:
		return "unknown"
	}
}

// Memtable is a sorted, in-memory map safe for one writer and many readers.
type Memtable struct {
	mu   sync.RWMutex
	list *skiplist
}

// New returns an empty memtable.
func New() *Memtable {
	return &Memtable{list: newSkiplist(0x5EED)}
}

// Put stores value under key, replacing anything written for key before.
//
// Key and value are copied, so callers may reuse their buffers.
func (m *Memtable) Put(key, value []byte) {
	k := append([]byte(nil), key...)
	v := append([]byte{}, value...)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.list.put(k, v, KindValue)
}

// Delete records that key no longer exists.
func (m *Memtable) Delete(key []byte) {
	k := append([]byte(nil), key...)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.list.put(k, nil, KindTombstone)
}

// Get looks key up in this memtable only.
//
// The value is returned only when the result is Found. It is the memtable's
// own slice; callers must not modify it.
func (m *Memtable) Get(key []byte) ([]byte, Result) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := m.list.get(key)
	switch {
	case n == nil:
		return nil, Missing
	case n.kind == KindTombstone:
		return nil, Deleted
	default:
		return n.value, Found
	}
}

// Len is the number of entries, tombstones included.
func (m *Memtable) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.list.length
}

// ApproximateSize is the memory the entries account for, in bytes.
func (m *Memtable) ApproximateSize() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.list.size
}
