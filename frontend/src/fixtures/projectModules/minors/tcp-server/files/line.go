package main

import (
	"errors"
	"fmt"
	"strings"
)

// CRLF terminates every request and every reply.
const CRLF = "\r\n"

// ErrEmpty is returned for a line with no verb. Callers usually ignore the
// request rather than treating it as a protocol violation.
var ErrEmpty = errors.New("empty request")

// Request is one parsed command line.
type Request struct {
	// Name is the verb, upper-cased so dispatch can be case-insensitive.
	Name string
	// Args are the whitespace-separated arguments after the verb.
	Args []string
}

// ParseLine splits a single request line into a Request. The line may still
// carry its trailing CR and/or LF; both are stripped.
func ParseLine(line string) (Request, error) {
	fields := strings.Fields(strings.TrimRight(line, "\r\n"))
	if len(fields) == 0 {
		return Request{}, ErrEmpty
	}
	return Request{
		Name: strings.ToUpper(fields[0]),
		Args: fields[1:],
	}, nil
}

// Reply formats a successful reply.
func Reply(s string) string { return s + CRLF }

// ErrorReply formats an error reply. The message is flattened onto one line
// because the framing is line based.
func ErrorReply(msg string) string {
	return "ERR " + strings.ReplaceAll(msg, "\n", " ") + CRLF
}

// ErrorReplyf is ErrorReply with formatting.
func ErrorReplyf(format string, args ...any) string {
	return ErrorReply(fmt.Sprintf(format, args...))
}
