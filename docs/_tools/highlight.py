#!/usr/bin/env python3
"""Syntax highlighting for the documentation site's code blocks.

Highlighting happens here, at authoring time, rather than in the browser. A runtime highlighter
would mean shipping a library the site is not allowed to fetch (no CDN, no build step, no npm),
would leave every snippet unstyled for readers with JavaScript off, and would repaint 61 code
blocks on every page load. Emitting the spans once costs nothing at read time.

Tokens are flat — never nested — which is what lets `strip()` undo the whole pass by deleting the
opening spans and their closers, so re-running the generator re-highlights from clean source
instead of wrapping spans in spans.
"""

from __future__ import annotations

import html
import re

# --------------------------------------------------------------------------- vocabulary

KEYWORDS = {
    "ts": {
        "kw": {"import", "from", "export", "default", "const", "let", "var", "function", "return",
               "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new",
               "class", "extends", "implements", "interface", "type", "enum", "async", "await",
               "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "as",
               "public", "private", "protected", "readonly", "static", "get", "set", "declare",
               "namespace", "delete", "void", "yield", "satisfies"},
        "typ": {"string", "number", "boolean", "object", "any", "unknown", "never", "Promise",
                "Array", "Record", "Partial", "Readonly", "React", "JSX", "Error", "Date", "Map",
                "Set", "RegExp", "JSON", "Math", "URL"},
        "lit": {"true", "false", "null", "undefined", "this", "super", "NaN", "Infinity"},
    },
    "swift": {
        "kw": {"import", "func", "let", "var", "return", "if", "else", "guard", "for", "while",
               "switch", "case", "default", "break", "continue", "class", "struct", "enum",
               "protocol", "extension", "init", "deinit", "self", "super", "public", "private",
               "internal", "fileprivate", "open", "static", "final", "override", "mutating",
               "throws", "throw", "try", "catch", "do", "defer", "async", "await", "where", "in",
               "is", "as", "some", "any", "weak", "unowned", "lazy", "inout", "typealias",
               "associatedtype", "subscript", "willSet", "didSet", "convenience", "required"},
        "typ": {"String", "Int", "Double", "Float", "Bool", "Void", "Any", "AnyObject", "Data",
                "URL", "Date", "Array", "Dictionary", "Set", "Optional", "Result", "Error",
                "UIView", "UIViewController", "UIColor", "WKWebView", "Task", "Locale"},
        "lit": {"true", "false", "nil"},
    },
    "kotlin": {
        "kw": {"import", "package", "fun", "val", "var", "return", "if", "else", "for", "while",
               "do", "when", "break", "continue", "class", "object", "interface", "enum", "data",
               "sealed", "abstract", "open", "override", "private", "protected", "public",
               "internal", "companion", "init", "constructor", "this", "super", "is", "as", "in",
               "out", "by", "lateinit", "lazy", "suspend", "try", "catch", "finally", "throw",
               "typealias", "vararg", "inline", "reified", "operator", "const"},
        "typ": {"String", "Int", "Long", "Double", "Float", "Boolean", "Unit", "Any", "Nothing",
                "List", "MutableList", "Map", "MutableMap", "Set", "Array", "Context", "View",
                "Activity", "Fragment", "Bundle", "Uri", "Intent"},
        "lit": {"true", "false", "null"},
    },
}

# Ordered alternation: comments and strings must win before anything inside them is mistaken for
# code, and a name followed by "(" must win before the plain-word rule claims it.
CODE_RE = re.compile(r"""
    (?P<com>//[^\n]*|\#[^\n]*|/\*.*?\*/)
  | (?P<str>\"\"\".*?\"\"\"|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\")
  | (?P<ann>@[A-Za-z_][\w]*)
  | (?P<num>\b0[xX][0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?\b)
  | (?P<fn>\b[A-Za-z_$][\w$]*(?=\s*\())
  | (?P<attr>\b[A-Za-z_$][\w$]*(?=\s*:(?!:)))
  | (?P<word>\b[A-Za-z_$][\w$]*\b)
  | (?P<op>=>|->|\?\?|\.\.\.|[=+\-*/%<>!&|?:.]+)
  | (?P<punc>[{}()\[\];,])
""", re.X | re.S)

SHELL_RE = re.compile(r"""
    (?P<com>\#[^\n]*)
  | (?P<str>'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\")
  | (?P<var>\$\{?[A-Za-z_][\w]*\}?)
  | (?P<op>--?[A-Za-z][\w-]*)
  | (?P<fn>^\s*[a-z][\w.-]*|(?<=\|\s)[a-z][\w.-]*)
  | (?P<num>\b\d+\b)
  | (?P<punc>[|&;<>()])
""", re.X | re.M)

JSON_RE = re.compile(r"""
    (?P<attr>\"(?:[^\"\\]|\\.)*\"(?=\s*:))
  | (?P<str>\"(?:[^\"\\]|\\.)*\")
  | (?P<num>-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)
  | (?P<lit>\b(?:true|false|null)\b)
  | (?P<punc>[{}\[\],:])
""", re.X)

MARKUP_RE = re.compile(r"""
    (?P<com><!--.*?-->)
  | (?P<tag></?[A-Za-z][\w:.-]*)
  | (?P<str>\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*')
  | (?P<attr>\b[A-Za-z_:][\w:.-]*(?=\s*=))
  | (?P<punc>[<>/]+)
""", re.X | re.S)


# --------------------------------------------------------------------------- detection

def detect(code: str) -> str | None:
    """Guess the language from shapes that only one of them has.

    Ordered most-distinctive first. Returning None leaves the block untouched, which is the right
    answer for output logs, plain text and anything ambiguous — a wrong guess paints a snippet in
    misleading colours, which is worse than leaving it plain.
    """
    head = code.lstrip()
    if head.startswith(("{", "[")) and re.search(r'^\s*"[^"]+"\s*:', code, re.M):
        return "json"
    if re.search(r"^\s*(?:\$|#)\s|\b(?:curl|npm|npx|pod|gradlew|adb|xcodebuild|swift build|cd)\b",
                 code, re.M) and not re.search(r"\b(?:func|fun|const|import)\b", code):
        return "shell"
    if head.startswith("<") or re.search(r"^\s*<\?xml|^\s*<[a-z]+[ >]", code, re.M):
        return "markup"
    if re.search(r"\b(?:func|guard|\blet\b.*:.*=|@objc|@MainActor)\b|-> Void|\bSwift\b", code) \
            and not re.search(r"\b(?:fun|val)\b", code):
        return "swift"
    if re.search(r"\bfun\b|\bval\b|\boverride fun\b|\bcompanion object\b|Kotlin", code):
        return "kotlin"
    if re.search(r"\b(?:const|let|import|export|interface|type|=>)\b|</\w+>", code):
        return "ts"
    return None


# --------------------------------------------------------------------------- rendering

def _span(cls: str, text: str) -> str:
    return f'<span class="tok-{cls}">{html.escape(text, quote=False)}</span>'


def highlight(code: str, lang: str) -> str:
    """Tokenise one block. Input is plain text; output is escaped HTML with flat token spans."""
    rx = {"shell": SHELL_RE, "json": JSON_RE, "markup": MARKUP_RE}.get(lang, CODE_RE)
    words = KEYWORDS.get(lang, {})
    out: list[str] = []
    pos = 0

    for m in rx.finditer(code):
        out.append(html.escape(code[pos:m.start()], quote=False))
        pos = m.end()
        kind = m.lastgroup
        text = m.group()

        if kind == "word":
            if text in words.get("kw", ()):
                kind = "kw"
            elif text in words.get("lit", ()):
                kind = "lit"
            elif text in words.get("typ", ()) or (text[:1].isupper() and len(text) > 1):
                kind = "typ"
            else:
                kind = "var"
        elif kind == "ann":
            kind = "typ"

        out.append(_span(kind, text))

    out.append(html.escape(code[pos:], quote=False))
    return "".join(out)


TOKEN_OPEN = re.compile(r'<span class="tok-[a-z]+">')


def strip(fragment: str) -> str:
    """Undo a previous pass so the generator re-highlights from clean source.

    Safe because the tokens are flat and nothing else in a code block is a <span>: remove every
    opening token span and exactly as many closers.
    """
    count = len(TOKEN_OPEN.findall(fragment))
    if not count:
        return fragment
    fragment = TOKEN_OPEN.sub("", fragment)
    return fragment.replace("</span>", "", count)


BLOCK_RE = re.compile(r'(<pre class="code"[^>]*><code[^>]*>)(.*?)(</code></pre>)', re.S)


def apply(body: str) -> tuple[str, int]:
    """Highlight every code block in a page body. Returns the body and how many were painted."""
    painted = 0

    def one(m):
        nonlocal painted
        open_tag, inner, close_tag = m.groups()
        plain = html.unescape(strip(inner))
        lang = detect(plain)
        if not lang:
            return f"{open_tag}{html.escape(plain, quote=False)}{close_tag}"
        painted += 1
        open_tag = re.sub(r' data-lang="[^"]*"', "", open_tag)
        open_tag = open_tag.replace("<code", f'<code data-lang="{lang}"', 1)
        return f"{open_tag}{highlight(plain, lang)}{close_tag}"

    return BLOCK_RE.sub(one, body), painted
