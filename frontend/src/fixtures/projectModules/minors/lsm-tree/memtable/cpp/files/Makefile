CXX      ?= c++
CXXFLAGS ?= -std=c++17 -O2 -g -Wall -Wextra
CPPFLAGS += -Isrc

LIB_SRCS := src/memtable/skiplist.cc src/memtable/memtable.cc src/memtable/iterator.cc
HDRS     := $(wildcard src/*/*.h) tests/check.h

.PHONY: test asan run clean

build/memtable_test: tests/memtable_test.cc $(LIB_SRCS) $(HDRS)
	@mkdir -p build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -o $@ tests/memtable_test.cc $(LIB_SRCS)

build/lsmkv: cmd/lsmkv/main.cc $(LIB_SRCS) $(HDRS)
	@mkdir -p build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -o $@ cmd/lsmkv/main.cc $(LIB_SRCS)

test: build/memtable_test
	./build/memtable_test

# Same tests under AddressSanitizer + UndefinedBehaviorSanitizer: catches
# use-after-free, out-of-bounds access, and undefined behaviour.
asan: tests/memtable_test.cc $(LIB_SRCS) $(HDRS)
	@mkdir -p build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -O1 -fsanitize=address,undefined -fno-omit-frame-pointer \
		-o build/memtable_test_asan tests/memtable_test.cc $(LIB_SRCS)
	./build/memtable_test_asan

run: build/lsmkv
	./build/lsmkv

clean:
	rm -rf build
