#include "memtable/iterator.h"

#include <stdexcept>

namespace lsmkv {

void Iterator::Seek(std::string_view target) {
  node_ = list_->FindGreaterOrEqual(target, nullptr);
}

void Iterator::Next() {
  node_ = node_->next[0];
}

}  // namespace lsmkv
