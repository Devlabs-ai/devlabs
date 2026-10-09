#include "memtable/iterator.h"

#include <stdexcept>

namespace lsmkv {

void Iterator::Seek(std::string_view target) {
  // ── TODO(1.4) — reuse the search ──────────────────────────────────────────
  //
  // You already wrote the function that answers "first key >= target".
  // No prev array is needed.
  (void)target;
  throw std::logic_error("TODO(1.4): Seek — position on the first key >= target");
}

void Iterator::Next() {
  // ── TODO(1.4) — level 0 is the full sorted list ───────────────────────────
  //
  // Upper levels skip nodes. Level 0 links every node in key order.
  throw std::logic_error("TODO(1.4): Next — step along level 0");
}

}  // namespace lsmkv
