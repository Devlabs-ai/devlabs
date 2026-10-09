#pragma once

// A tiny test harness so the repo needs nothing beyond a C++17 compiler.
// TEST(Name) registers a test; CHECK / CHECK_EQ fail it with a message.
// Exceptions thrown by the code under test (including the TODO stubs) fail
// only that test, and the run continues.

#include <exception>
#include <functional>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace check {

struct Failure {
  std::string message;
};

struct Case {
  const char* name;
  std::function<void()> fn;
};

inline std::vector<Case>& Registry() {
  static std::vector<Case> cases;
  return cases;
}

struct Registrar {
  Registrar(const char* name, std::function<void()> fn) {
    Registry().push_back({name, std::move(fn)});
  }
};

template <typename A, typename B>
void Equal(const A& got, const B& want, const char* expr, const char* file, int line) {
  if (got == want) return;
  std::ostringstream out;
  out << file << ":" << line << ": " << expr << "\n      got:  " << got << "\n      want: " << want;
  throw Failure{out.str()};
}

inline int RunAll() {
  int failed = 0;
  for (const Case& c : Registry()) {
    try {
      c.fn();
      std::cout << "PASS  " << c.name << "\n";
    } catch (const Failure& f) {
      ++failed;
      std::cout << "FAIL  " << c.name << "\n      " << f.message << "\n";
    } catch (const std::exception& e) {
      ++failed;
      std::cout << "FAIL  " << c.name << "\n      exception: " << e.what() << "\n";
    }
  }
  std::cout << "\n" << (Registry().size() - failed) << "/" << Registry().size() << " passed\n";
  return failed == 0 ? 0 : 1;
}

}  // namespace check

#define TEST(name)                                                  \
  static void name();                                               \
  static ::check::Registrar name##_registrar(#name, name);          \
  static void name()

#define CHECK(cond)                                                                 \
  do {                                                                              \
    if (!(cond)) {                                                                  \
      std::ostringstream check_out_;                                                \
      check_out_ << __FILE__ << ":" << __LINE__ << ": CHECK(" #cond ") failed";     \
      throw ::check::Failure{check_out_.str()};                                     \
    }                                                                               \
  } while (0)

#define CHECK_MSG(cond, msg)                                                        \
  do {                                                                              \
    if (!(cond)) {                                                                  \
      std::ostringstream check_out_;                                                \
      check_out_ << __FILE__ << ":" << __LINE__ << ": " << msg;                     \
      throw ::check::Failure{check_out_.str()};                                     \
    }                                                                               \
  } while (0)

#define CHECK_EQ(got, want) ::check::Equal((got), (want), #got " == " #want, __FILE__, __LINE__)
