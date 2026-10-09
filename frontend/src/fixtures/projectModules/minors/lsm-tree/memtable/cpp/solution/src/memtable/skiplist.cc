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
  Node* x = head_;
  for (int level = height_ - 1; level >= 0; --level) {
    while (x->next[level] != nullptr && Compare(x->next[level]->key, key) < 0) {
      x = x->next[level];
    }
    if (prev != nullptr) {
      prev[level] = x;
    }
  }
  return x->next[0];
}

Node* SkipList::Get(std::string_view key) const {
  Node* n = FindGreaterOrEqual(key, nullptr);
  if (n != nullptr && n->key == key) {
    return n;
  }
  return nullptr;
}

void SkipList::Put(std::string key, std::string value, Kind kind) {
  Node* prev[kMaxHeight];
  Node* x = FindGreaterOrEqual(key, prev);
  if (x != nullptr && x->key == key) {
    size_ = size_ - x->value.size() + value.size();
    x->value = std::move(value);
    x->kind = kind;
    return;
  }

  int h = RandomHeight();
  if (h > height_) {
    for (int i = height_; i < h; ++i) {
      prev[i] = head_;
    }
    height_ = h;
  }
  size_t entry = EntrySize(key, value);
  Node* n = NewNode(std::move(key), std::move(value), kind, h);
  for (int i = 0; i < h; ++i) {
    n->next[i] = prev[i]->next[i];
    prev[i]->next[i] = n;
  }
  ++length_;
  size_ += entry;
}

}  // namespace lsmkv
