import base64
import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core import auth as auth_module

TEST_SECRET = "test-jwt-secret-at-least-32-characters-long"
TEST_USER_ID = "11111111-1111-1111-1111-111111111111"


def _b64url_uint(n: int, length: int = 32) -> str:
    return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode()


def _ec_jwks_and_key(kid: str = "ec-key-1"):
    """A fresh EC keypair plus the JWKS JSON its public half would appear
    in - mirrors what infra/supabase's add-new-auth-keys.sh produces in
    JWT_JWKS, without needing the real vendored stack running."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    numbers = private_key.public_key().public_numbers()
    jwks_json = json.dumps(
        {
            "keys": [
                {
                    "kty": "EC",
                    "crv": "P-256",
                    "kid": kid,
                    "alg": "ES256",
                    "use": "sig",
                    "x": _b64url_uint(numbers.x),
                    "y": _b64url_uint(numbers.y),
                }
            ]
        }
    )
    return private_key, jwks_json


def _oct_jwks_json(secret: str, kid: str = "hs-key-1") -> str:
    return json.dumps(
        {
            "keys": [
                {
                    "kty": "oct",
                    "kid": kid,
                    "alg": "HS256",
                    "k": base64.urlsafe_b64encode(secret.encode()).rstrip(b"=").decode(),
                }
            ]
        }
    )


def _make_token(secret: str, sub: str, exp_delta: int = 3600, aud: str = "authenticated") -> str:
    payload = {"sub": sub, "aud": aud, "exp": int(time.time()) + exp_delta}
    return jwt.encode(payload, secret, algorithm="HS256")


def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_verify_jwt_returns_user_id_for_valid_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID)

    user_id = auth_module.verify_jwt(_credentials(token))

    assert user_id == TEST_USER_ID


def test_verify_jwt_rejects_expired_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID, exp_delta=-10)

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))

    assert exc_info.value.status_code == 401


def test_verify_jwt_rejects_wrong_secret(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token("a-completely-different-secret-value-here", sub=TEST_USER_ID)

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))

    assert exc_info.value.status_code == 401


def test_verify_jwt_rejects_wrong_audience(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID, aud="something-else")

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))

    assert exc_info.value.status_code == 401


def test_verify_jwt_ignores_empty_jwks_and_uses_the_legacy_secret(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: "")
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID)

    assert auth_module.verify_jwt(_credentials(token)) == TEST_USER_ID


def test_verify_jwt_accepts_an_es256_token_verified_via_jwks(monkeypatch):
    private_key, jwks_json = _ec_jwks_and_key()
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: jwks_json)
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)  # should never be reached

    token = jwt.encode(
        {"sub": TEST_USER_ID, "aud": "authenticated", "exp": int(time.time()) + 3600},
        private_key,
        algorithm="ES256",
        headers={"kid": "ec-key-1"},
    )

    assert auth_module.verify_jwt(_credentials(token)) == TEST_USER_ID


def test_verify_jwt_rejects_an_es256_token_with_a_forged_signature(monkeypatch):
    _real_private_key, jwks_json = _ec_jwks_and_key()
    forged_private_key = ec.generate_private_key(ec.SECP256R1())  # attacker's own key, wrong one
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: jwks_json)
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)

    forged_token = jwt.encode(
        {"sub": TEST_USER_ID, "aud": "authenticated", "exp": int(time.time()) + 3600},
        forged_private_key,
        algorithm="ES256",
        headers={"kid": "ec-key-1"},  # claims to be the real key, isn't
    )

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(forged_token))
    assert exc_info.value.status_code == 401


def test_verify_jwt_accepts_the_legacy_oct_key_inside_a_jwks(monkeypatch):
    # The stack's own JWT_JWKS carries the HS256 secret as an 'oct' entry
    # alongside the EC key, so old-style HS256 tokens verify via the same
    # JWKS path, not just the plain-secret fallback.
    jwks_json = _oct_jwks_json(TEST_SECRET)
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: jwks_json)
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: "should-not-be-used")

    token = jwt.encode(
        {"sub": TEST_USER_ID, "aud": "authenticated", "exp": int(time.time()) + 3600},
        TEST_SECRET,
        algorithm="HS256",
        headers={"kid": "hs-key-1"},
    )

    assert auth_module.verify_jwt(_credentials(token)) == TEST_USER_ID


def test_verify_jwt_falls_back_to_the_legacy_secret_when_kid_is_not_in_the_jwks(monkeypatch):
    # A token issued before a key rotation - no matching kid in the
    # (post-rotation) JWKS, but still a legitimate HS256 token signed
    # with the shared secret (Section 17's "planned key-rotation window").
    _private_key, jwks_json = _ec_jwks_and_key(kid="new-key-after-rotation")
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: jwks_json)
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)

    old_token = _make_token(TEST_SECRET, sub=TEST_USER_ID)  # no kid header at all

    assert auth_module.verify_jwt(_credentials(old_token)) == TEST_USER_ID


def test_verify_jwt_rejects_a_token_with_no_matching_key_and_wrong_secret(monkeypatch):
    _private_key, jwks_json = _ec_jwks_and_key()
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: jwks_json)
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)

    token = _make_token("a-completely-different-secret-value-here", sub=TEST_USER_ID)

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))
    assert exc_info.value.status_code == 401


def test_load_jwk_set_returns_none_for_malformed_json():
    assert auth_module._load_jwk_set("not valid json") is None


def test_load_jwk_set_returns_none_for_empty_keys_list():
    assert auth_module._load_jwk_set('{"keys": []}') is None


def test_verify_jwt_or_api_token_routes_a_supabase_jwt_to_verify_jwt(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    monkeypatch.setattr(auth_module, "_get_jwks_json", lambda: "")
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID)

    assert auth_module.verify_jwt_or_api_token(_credentials(token)) == TEST_USER_ID


# --- API token tests (personal access tokens, Section 17's public API) -
# these hit a real database, matching the sibling test files' pattern
# (test_captures.py, test_agents.py), since _verify_api_token's whole job
# is a database lookup, not a pure signature check.
import os
from datetime import datetime

import psycopg

DATABASE_URL = os.environ["DATABASE_URL"]
API_TOKEN_TEST_USER_ID = "23232323-2323-2323-2323-232323232323"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase-api-token-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (API_TOKEN_TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (API_TOKEN_TEST_USER_ID,))
        connection.commit()


def _insert_api_token(conn, token: str, revoked: bool = False) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into api_tokens (user_id, name, token_hash, token_prefix, revoked_at)
            values (%s, 'test token', %s, %s, %s)
            """,
            (
                API_TOKEN_TEST_USER_ID,
                auth_module._hash_api_token(token),
                token[:12],
                datetime.now() if revoked else None,
            ),
        )
    conn.commit()


def test_verify_jwt_or_api_token_accepts_a_valid_api_token(conn):
    token = auth_module.API_TOKEN_PREFIX + "a-valid-test-token-value"
    _insert_api_token(conn, token)

    user_id = auth_module.verify_jwt_or_api_token(_credentials(token))

    assert user_id == API_TOKEN_TEST_USER_ID


def test_verify_jwt_or_api_token_updates_last_used_at(conn):
    token = auth_module.API_TOKEN_PREFIX + "another-valid-token"
    _insert_api_token(conn, token)

    auth_module.verify_jwt_or_api_token(_credentials(token))

    with conn.cursor() as cur:
        cur.execute(
            "select last_used_at from api_tokens where token_hash = %s",
            (auth_module._hash_api_token(token),),
        )
        assert cur.fetchone()[0] is not None


def test_verify_jwt_or_api_token_rejects_an_unknown_token(conn):
    token = auth_module.API_TOKEN_PREFIX + "never-issued"

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt_or_api_token(_credentials(token))
    assert exc_info.value.status_code == 401


def test_verify_jwt_or_api_token_rejects_a_revoked_token(conn):
    token = auth_module.API_TOKEN_PREFIX + "a-revoked-token"
    _insert_api_token(conn, token, revoked=True)

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt_or_api_token(_credentials(token))
    assert exc_info.value.status_code == 401
