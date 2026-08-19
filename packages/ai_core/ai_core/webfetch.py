"""Outbound web fetch for the Research agent (design doc Section 6/17) -
the one MVP-deferred integration surface ("Research Agent: needs
outbound web fetch and document comparison across sources, a distinct
integration surface from everything else in the MVP"), now built.

Deliberately minimal: stdlib `html.parser` only, no BeautifulSoup or
similar - a research source just needs "readable text from a web page",
not a full DOM/CSS-aware scraper. Not reused by the Phase 1 capture
pipeline's `kind: url` captures (those still treat the URL string itself
as the capture's text, unchanged) - that's a real gap worth revisiting,
just not folded into this pass.

SSRF guard: this endpoint takes a user-supplied URL and fetches it from
inside our own network (which, under docker-compose, includes `kong`,
`supabase-db`, and friends by hostname), so every hostname - the initial
one and any redirect target - is resolved and checked against
private/loopback/link-local/reserved/multicast ranges before a request
is made to it. Redirects are followed manually (not via httpx's
built-in follow_redirects) specifically so each hop gets the same check;
auto-following would let a first-hop-safe URL 302 to an internal address
unchecked.
"""

from __future__ import annotations

import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

FETCH_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 3 * 1024 * 1024  # 3MB - a research source shouldn't need more
MAX_REDIRECTS = 5
USER_AGENT = "AgenticSecondBrain-ResearchAgent/1.0 (+personal knowledge tool)"
_SKIP_TAGS = {"script", "style", "noscript", "nav", "footer", "header"}

# Cloud metadata endpoints - not covered by the private/loopback/etc.
# checks below since 169.254.169.254 is link-local (already blocked),
# but the hostnames are worth blocking explicitly too since some
# providers accept the name directly.
_BLOCKED_HOSTNAMES = {"metadata.google.internal", "metadata.aws.internal"}


class InvalidUrlError(ValueError):
    pass


class FetchError(RuntimeError):
    pass


def _validate_host_is_public(hostname: str) -> None:
    """Resolve `hostname` and reject it if it (or anything it resolves
    to) is not a routable public address. Raises InvalidUrlError, not
    FetchError - this is a request-shape rejection, not a network
    failure, same category as the scheme check."""
    if hostname.lower() in _BLOCKED_HOSTNAMES:
        raise InvalidUrlError(f"host '{hostname}' is not allowed")

    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise InvalidUrlError(f"couldn't resolve host '{hostname}'") from exc

    for info in addr_infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise InvalidUrlError(f"host '{hostname}' resolves to a disallowed address")


def _validate_url(url: str) -> str:
    """Scheme + host checks shared by the initial URL and every redirect
    hop. Returns the hostname (callers already need it validated, no
    reason to re-parse)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not parsed.hostname:
        raise InvalidUrlError(f"'{url}' is not a valid http(s) URL")
    _validate_host_is_public(parsed.hostname)
    return parsed.hostname


class _TextExtractor(HTMLParser):
    """Strips markup and script/style/nav/footer/header content, keeping
    everything else as flat lines of text - not a readability algorithm,
    just enough to hand the model prose instead of markup soup."""

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            stripped = data.strip()
            if stripped:
                self.chunks.append(stripped)


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return "\n".join(parser.chunks)


def fetch_url_text(url: str, *, client: httpx.Client | None = None) -> str:
    """Fetch a URL and return its readable text. Raises InvalidUrlError
    for a non-http(s) URL or one that resolves to a non-public address
    (checked again on every redirect hop), FetchError for anything that
    goes wrong at the network/content layer (non-2xx, unsupported
    content type, over the size cap, too many redirects) - callers
    (ResearchAgent) decide whether one failed source should abort the
    whole request or just be skipped."""
    _validate_url(url)

    owns_client = client is None
    # follow_redirects=False is deliberate here (see module docstring) -
    # redirects are walked manually below so each hop's host is
    # re-validated before it's ever requested.
    client = client or httpx.Client(
        follow_redirects=False, timeout=FETCH_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}
    )
    try:
        current_url = url
        response = None
        for _ in range(MAX_REDIRECTS + 1):
            try:
                response = client.get(current_url, headers={"User-Agent": USER_AGENT})
            except httpx.HTTPError as exc:
                raise FetchError(f"couldn't fetch {current_url}: {exc}") from exc

            if not response.is_redirect:
                break

            location = response.headers.get("location")
            if not location:
                raise FetchError(f"redirect from {current_url} had no Location header")
            current_url = urljoin(current_url, location)
            _validate_url(current_url)
        else:
            raise FetchError(f"too many redirects fetching {url}")

        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise FetchError(f"couldn't fetch {current_url}: {exc}") from exc

        if len(response.content) > MAX_RESPONSE_BYTES:
            raise FetchError(f"{current_url} exceeded the {MAX_RESPONSE_BYTES}-byte fetch limit")

        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "text/plain" not in content_type:
            raise FetchError(f"unsupported content type '{content_type}' for {current_url}")

        text = response.text
        if "text/html" in content_type:
            text = html_to_text(text)
        return text.strip()
    finally:
        if owns_client:
            client.close()
