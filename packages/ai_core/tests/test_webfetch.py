import socket

import httpx
import pytest

import ai_core.webfetch as webfetch_module
from ai_core.webfetch import (
    FetchError,
    InvalidUrlError,
    fetch_url_text,
    html_to_text,
)


def test_html_to_text_strips_tags_and_skip_regions():
    html = """
    <html>
      <head><style>body { color: red }</style></head>
      <body>
        <nav>Home | About</nav>
        <script>console.log('hi')</script>
        <h1>Main title</h1>
        <p>Some <b>bold</b> paragraph text.</p>
        <footer>copyright 2026</footer>
      </body>
    </html>
    """
    text = html_to_text(html)
    assert "Main title" in text
    assert "Some" in text and "bold" in text and "paragraph text." in text
    assert "Home | About" not in text
    assert "console.log" not in text
    assert "copyright 2026" not in text


def _client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture
def _allow_all_hosts(monkeypatch):
    # These tests exercise fetch behavior (parsing, status handling, size
    # caps), not the SSRF guard itself - real DNS resolution of
    # "example.com" would make them dependent on network availability.
    # Requested explicitly by each test below that needs it - NOT applied
    # to TestSsrfGuard's tests, since defanging the guard would make
    # those pass for the wrong reason.
    monkeypatch.setattr(webfetch_module, "_validate_host_is_public", lambda hostname: None)


def test_fetch_url_text_extracts_html_body(_allow_all_hosts):
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<p>Hello world</p>")

    result = fetch_url_text("https://example.com/page", client=_client_for(handler))

    assert result == "Hello world"


def test_fetch_url_text_returns_plain_text_as_is(_allow_all_hosts):
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/plain"}, text="raw notes here")

    result = fetch_url_text("https://example.com/notes.txt", client=_client_for(handler))

    assert result == "raw notes here"


def test_fetch_url_text_rejects_a_non_http_url():
    with pytest.raises(InvalidUrlError):
        fetch_url_text("ftp://example.com/file")


def test_fetch_url_text_raises_on_http_error_status(_allow_all_hosts):
    def handler(request):
        return httpx.Response(404, text="not found")

    with pytest.raises(FetchError):
        fetch_url_text("https://example.com/missing", client=_client_for(handler))


def test_fetch_url_text_rejects_unsupported_content_type(_allow_all_hosts):
    def handler(request):
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF-1.4")

    with pytest.raises(FetchError, match="unsupported content type"):
        fetch_url_text("https://example.com/file.pdf", client=_client_for(handler))


def test_fetch_url_text_rejects_oversized_responses(monkeypatch, _allow_all_hosts):
    monkeypatch.setattr(webfetch_module, "MAX_RESPONSE_BYTES", 10)

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/plain"}, text="way more than ten bytes")

    with pytest.raises(FetchError, match="byte fetch limit"):
        fetch_url_text("https://example.com/big", client=_client_for(handler))


def test_fetch_url_text_follows_a_redirect_to_an_allowed_host(_allow_all_hosts):
    def handler(request):
        if request.url.host == "start.example.com":
            return httpx.Response(302, headers={"location": "https://end.example.com/final"})
        return httpx.Response(200, headers={"content-type": "text/plain"}, text="final content")

    result = fetch_url_text("https://start.example.com/", client=_client_for(handler))

    assert result == "final content"


def test_fetch_url_text_gives_up_after_too_many_redirects(_allow_all_hosts):
    def handler(request):
        return httpx.Response(302, headers={"location": "https://example.com/loop"})

    with pytest.raises(FetchError, match="too many redirects"):
        fetch_url_text("https://example.com/loop", client=_client_for(handler))


def test_fetch_url_text_revalidates_the_host_on_redirect(monkeypatch):
    # Only the first hop's host is pre-approved by the fixture override
    # below - the redirect target must independently pass the guard.
    calls = []

    def guard(hostname):
        calls.append(hostname)
        if hostname == "internal.example.com":
            raise InvalidUrlError(f"host '{hostname}' resolves to a disallowed address")

    monkeypatch.setattr(webfetch_module, "_validate_host_is_public", guard)

    def handler(request):
        return httpx.Response(302, headers={"location": "https://internal.example.com/secret"})

    with pytest.raises(InvalidUrlError, match="disallowed address"):
        fetch_url_text("https://start.example.com/", client=_client_for(handler))

    assert calls == ["start.example.com", "internal.example.com"]


class TestSsrfGuard:
    """_validate_host_is_public is the actual SSRF guard - tested
    directly with mocked DNS so no real network/resolver is involved."""

    def _mock_resolve(self, monkeypatch, ip: str):
        def fake_getaddrinfo(hostname, port):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))]

        monkeypatch.setattr(webfetch_module.socket, "getaddrinfo", fake_getaddrinfo)

    def test_rejects_loopback(self, monkeypatch):
        self._mock_resolve(monkeypatch, "127.0.0.1")
        with pytest.raises(InvalidUrlError, match="disallowed address"):
            fetch_url_text("http://localhost/")

    def test_rejects_link_local_metadata_ip(self, monkeypatch):
        self._mock_resolve(monkeypatch, "169.254.169.254")
        with pytest.raises(InvalidUrlError, match="disallowed address"):
            fetch_url_text("http://169.254.169.254/latest/meta-data/")

    def test_rejects_private_range(self, monkeypatch):
        self._mock_resolve(monkeypatch, "10.0.0.5")
        with pytest.raises(InvalidUrlError, match="disallowed address"):
            fetch_url_text("http://internal-service/")

    def test_rejects_docker_internal_hostname_resolving_privately(self, monkeypatch):
        self._mock_resolve(monkeypatch, "172.18.0.5")
        with pytest.raises(InvalidUrlError, match="disallowed address"):
            fetch_url_text("http://kong:8000/")

    def test_rejects_known_metadata_hostname_outright(self):
        with pytest.raises(InvalidUrlError, match="not allowed"):
            fetch_url_text("http://metadata.google.internal/computeMetadata/v1/")

    def test_rejects_unresolvable_host(self, monkeypatch):
        def fake_getaddrinfo(hostname, port):
            raise socket.gaierror("not found")

        monkeypatch.setattr(webfetch_module.socket, "getaddrinfo", fake_getaddrinfo)
        with pytest.raises(InvalidUrlError, match="couldn't resolve"):
            fetch_url_text("http://this-does-not-resolve.invalid/")

    def test_allows_a_public_address(self, monkeypatch):
        self._mock_resolve(monkeypatch, "93.184.216.34")

        def handler(request):
            return httpx.Response(200, headers={"content-type": "text/plain"}, text="ok")

        result = fetch_url_text("https://example.com/", client=_client_for(handler))
        assert result == "ok"
