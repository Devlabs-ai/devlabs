package memtable

import (
	"bytes"
	"math/rand"
)

const (
	// maxHeight caps how many express lanes a node can join. With branching 4,
	// 12 levels comfortably index 4^12 (~16M) entries.
	maxHeight = 12
	// branching: on average one node in four is promoted one level up.
	branching = 4
	// nodeOverhead approximates the per-entry bookkeeping a node costs beyond
	// its key and value bytes. Chapter 3 flushes when the total crosses a limit.
	nodeOverhead = 32
)

// Kind says what an entry means.
type Kind uint8

const (
	// KindValue is a live key/value pair.
	KindValue Kind = iota + 1
	// KindTombstone marks a deleted key. Older tables may still hold a value
	// for it, so the marker has to be stored, not the key removed.
	KindTombstone
)

func (k Kind) String() string {
	switch k {
	case KindValue:
		return "value"
	case KindTombstone:
		return "tombstone"
	default:
		return "unknown"
	}
}

type node struct {
	key   []byte
	value []byte
	kind  Kind
	// next[i] is this node's successor on level i. len(next) is the node's height.
	next []*node
}

// skiplist is a sorted map from key to (value, kind).
//
// It is not safe for concurrent use; Memtable serializes access to it.
type skiplist struct {
	// head is a sentinel with no key and a full-height tower.
	head *node
	// height is the tallest tower currently in the list (at least 1).
	height int
	length int
	size   int
	rnd    *rand.Rand
	// compares counts key comparisons made by compare. Tests read it to check
	// that search uses the upper levels instead of crawling level 0.
	compares int
}

func newSkiplist(seed int64) *skiplist {
	return &skiplist{
		head:   &node{next: make([]*node, maxHeight)},
		height: 1,
		rnd:    rand.New(rand.NewSource(seed)),
	}
}

func (s *skiplist) compare(a, b []byte) int {
	s.compares++
	return bytes.Compare(a, b)
}

// randomHeight returns 1 with probability 3/4, 2 with 3/16, 3 with 3/64, ...
func (s *skiplist) randomHeight() int {
	h := 1
	for h < maxHeight && s.rnd.Intn(branching) == 0 {
		h++
	}
	return h
}

func entrySize(key, value []byte) int {
	return len(key) + len(value) + nodeOverhead
}

// findGreaterOrEqual returns the first node whose key is >= key, or nil if
// every key is smaller.
//
// If prev is non-nil (length maxHeight), prev[i] is set to the last node on
// level i whose key is < key: the node a new entry would be spliced after.
func (s *skiplist) findGreaterOrEqual(key []byte, prev []*node) *node {
	// ── TODO(1.1) — walk the express lanes ──────────────────────────────────
	//
	// x := s.head
	// for level := s.height - 1; level >= 0; level-- {
	//   while x.next[level] exists and its key < key (use s.compare):
	//     x = x.next[level]          // move right on this lane
	//   if prev != nil: prev[level] = x   // last node before key on this lane
	//   // then drop one level down and keep going from x
	// }
	// return x.next[0]
	//
	// Never restart from the head on a lower level. Dropping down from where
	// you are is what makes search O(log n) instead of O(n).
	panic("TODO(1.1): findGreaterOrEqual — walk right, drop down, record prev")
}

// get returns the node holding key, or nil.
func (s *skiplist) get(key []byte) *node {
	n := s.findGreaterOrEqual(key, nil)
	if n != nil && bytes.Equal(n.key, key) {
		return n
	}
	return nil
}

// put inserts key or overwrites its existing entry. The skiplist keeps the
// slices it is given; Memtable copies them first.
func (s *skiplist) put(key, value []byte, kind Kind) {
	// ── TODO(1.2) — overwrite or splice ─────────────────────────────────────
	//
	// 1. var prev [maxHeight]*node
	//    x := s.findGreaterOrEqual(key, prev[:])
	//
	// 2. Same key already present (bytes.Equal)? Overwrite x.value and x.kind
	//    in place, adjust s.size by the value-length difference, and return.
	//    Length does not change: one key, one entry.
	//
	// 3. New key: h := s.randomHeight(). If h > s.height, the levels in
	//    [s.height, h) had no towers yet, so their predecessor is s.head;
	//    set those prev entries and raise s.height.
	//
	// 4. Build the node with next = make([]*node, h). For every level
	//    i < h: n.next[i] = prev[i].next[i]; prev[i].next[i] = n.
	//
	// 5. s.length++ and s.size += entrySize(key, value).
	panic("TODO(1.2): put — overwrite in place or splice a new tower")
}
