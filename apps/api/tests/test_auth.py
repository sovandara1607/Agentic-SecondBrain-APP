import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core import auth as auth_module

TEST_SECRET = "test-jwt-secret-at-least-32-characters-long"
TEST_USER_ID = "11111111-1111-1111-1111-111111111111"


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
