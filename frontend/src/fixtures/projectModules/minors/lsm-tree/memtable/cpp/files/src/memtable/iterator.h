#pragma once

#include <string_view>

#include "memtable/skiplist.h"

namespace lsmkv {

// Walks a memtable in ascending key order, tombstones included.
//
// It takes no lock. Iterate a memtable that is no longer being written to
// (chapter 3 flushes frozen memtables) or from the writer's own thread. The
// memtable must outlive the iterator.
class Iterator {
 public:
  explicit Iterator(const SkipList* list) : list_(list) {}

  // Whether the iterator is positioned on an entry.
  bool Valid() const { return node_ != nullptr; }

  // Only call these when Valid().
  std::string_view Key() const { return node_->key; }
  // Empty for tombstones.
  std::string_view Value() const { return node_->value; }
  Kind kind() const { return node_->kind; }

  // Positions on the smallest key.
  void SeekToFirst() { node_ = list_->First(); }

  // Positions on the first key >= target.
  void Seek(std::string_view target);

  // Moves to the following key. Only call when Valid().
  void Next();

 private:
  const SkipList* list_;
  const Node* node_ = nullptr;
};

}  // namespace lsmkv
