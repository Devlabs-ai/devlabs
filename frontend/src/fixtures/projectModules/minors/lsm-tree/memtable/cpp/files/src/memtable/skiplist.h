#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <random>
#include <string>
#include <string_view>
#include <vector>

namespace lsmkv {

// How many express lanes a node can join. With kBranching 4, 12 levels
// comfortably index 4^12 (~16M) entries.
constexpr int kMaxHeight = 12;
// On average one node in four is promoted one level up.
constexpr int kBranching = 4;
// Approximate per-entry bookkeeping beyond the key and value bytes.
// Chapter 3 flushes when the total crosses a limit.
constexpr size_t kNodeOverhead = 32;

// What an entry means.
enum class Kind {
  kValue,
  // A deleted key. Older tables may still hold a value for it, so the marker
  // has to be stored, not the key removed.
  kTombstone,
};

const char* KindName(Kind kind);

struct Node {
  std::string key;
  std::string value;
  Kind kind = Kind::kValue;
  // next[i] is this node's successor on level i. next.size() is its height.
  std::vector<Node*> next;
};

inline size_t EntrySize(std::string_view key, std::string_view value) {
  return key.size() + value.size() + kNodeOverhead;
}

// A sorted map from key to (value, kind).
//
// The list owns every node through arena_; links between nodes are raw
// pointers into it. Nodes are never freed individually, only all at once when
// the list is destroyed. Not thread-safe; Memtable serializes access.
class SkipList {
 public:
  explicit SkipList(uint64_t seed);

  SkipList(const SkipList&) = delete;
  SkipList& operator=(const SkipList&) = delete;

  // Returns the first node whose key is >= key, or nullptr.
  //
  // If prev is non-null (an array of kMaxHeight), prev[i] is set to the last
  // node on level i whose key is < key: the node a new entry would be
  // spliced after.
  Node* FindGreaterOrEqual(std::string_view key, Node** prev) const;

  // The node holding key, or nullptr.
  Node* Get(std::string_view key) const;

  // Inserts key or overwrites its existing entry.
  void Put(std::string key, std::string value, Kind kind);

  Node* First() const { return head_->next[0]; }
  int height() const { return height_; }
  size_t length() const { return length_; }
  size_t size() const { return size_; }

  // Key comparisons made so far. Tests read it to check that search uses the
  // upper levels instead of crawling level 0.
  uint64_t compares() const { return compares_; }
  void ResetCompares() { compares_ = 0; }

 private:
  int Compare(std::string_view a, std::string_view b) const {
    ++compares_;
    return a.compare(b);
  }

  // 1 with probability 3/4, 2 with 3/16, 3 with 3/64, ...
  int RandomHeight();

  // Allocates a node with a tower of `height` null links, owned by arena_.
  Node* NewNode(std::string key, std::string value, Kind kind, int height);

  std::vector<std::unique_ptr<Node>> arena_;
  // Sentinel with no key and a full-height tower.
  Node* head_;
  // Tallest tower currently in the list (at least 1).
  int height_ = 1;
  size_t length_ = 0;
  size_t size_ = 0;
  std::mt19937_64 rnd_;
  mutable uint64_t compares_ = 0;
};

}  // namespace lsmkv
