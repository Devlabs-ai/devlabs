#include "memtable/skiplist.h"

#include <stdexcept>
#include <utility>

namespace lsmkv {

const char* KindName(Kind kind) {
  return kind == Kind::kTombstone ? "tombstone" : "value";
}

SkipList::SkipList(uint64_t seed) : rnd_(seed) {
  head_ = NewNode("", "", Kind::kValue, kMaxHeight);
}

Node* SkipList::NewNode(std::string key, std::string value, Kind kind, int height) {
  auto node = std::make_unique<Node>();
  node->key = std::move(key);
  node->value = std::move(value);
  node->kind = kind;
  node->next.assign(height, nullptr);
  arena_.push_back(std::move(node));
  return arena_.back().get();
}

int SkipList::RandomHeight() {
  int h = 1;
  while (h < kMaxHeight && rnd_() % kBranching == 0) {
    ++h;
  }
  return h;
}

Node* SkipList::FindGreaterOrEqual(std::string_view key, Node** prev) const {
  // ── TODO(1.1) — walk the express lanes ────────────────────────────────────
  //
  // Node* x = head_;
  // for (int level = height_ - 1; level >= 0; --level) {
  //   while x->next[level] != nullptr and Compare(x->next[level]->key, key) < 0:
  //     x = x->next[level];             // move right on this lane
  //   if (prev != nullptr) prev[level] = x;   // last node before key here
  //   // then drop one level down and keep going from x
  // }
  // return x->next[0];
  //
  // Never restart from the head on a lower level. Dropping down from where
  // you are is what makes search O(log n) instead of O(n).
  (void)key;
  (void)prev;
  throw std::logic_error("TODO(1.1): FindGreaterOrEqual — walk right, drop down, record prev");
}

Node* SkipList::Get(std::string_view key) const {
  Node* n = FindGreaterOrEqual(key, nullptr);
  if (n != nullptr && n->key == key) {
    return n;
  }
  return nullptr;
}

void SkipList::Put(std::string key, std::string value, Kind kind) {
  // ── TODO(1.2) — overwrite or splice ───────────────────────────────────────
  //
  // 1. Node* prev[kMaxHeight];
  //    Node* x = FindGreaterOrEqual(key, prev);
  //
  // 2. Same key already present (x != nullptr && x->key == key)? Overwrite
  //    x->value and x->kind in place, adjust size_ by the value-length
  //    difference, and return. size_ is unsigned, so subtract the old length
  //    and add the new one rather than computing a negative delta. Length
  //    does not change: one key, one entry.
  //
  // 3. New key: int h = RandomHeight(). If h > height_, the levels in
  //    [height_, h) had no towers yet, so their predecessor is head_; set
  //    those prev entries and raise height_.
  //
  // 4. Node* n = NewNode(...) with height h (move key and value in; take
  //    EntrySize first, or copy what you need, since moved-from strings are
  //    empty). For every level i < h:
  //      n->next[i] = prev[i]->next[i]; prev[i]->next[i] = n;
  //
  // 5. ++length_ and size_ += EntrySize(key, value).
  (void)key;
  (void)value;
  (void)kind;
  throw std::logic_error("TODO(1.2): Put — overwrite in place or splice a new tower");
}

}  // namespace lsmkv
