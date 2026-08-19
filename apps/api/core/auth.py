import hashlib

import jwt
import psycopg
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import get_settings

security = HTTPBearer()

# V2 roadmap (Section 17): "Public API: for users who want to script
# their own capture sources." A long-lived personal access token,
# recognizable by prefix so verify_jwt_or_api_token can route to the
# right verifier without trying (and always failing) the wrong one
# first - a Supabase JWT never starts this way.
API_TOKEN_PREFIX = "sb_pat_"


def _get_jwt_secret() -> str:
    return get_settings().jwt_secret


def _get_jwks_json() -> str:
    return get_settings().jwt_jwks


def _load_jwk_set(jwks_json: str) -> jwt.PyJWKSet | None:
    """Parse the static JWKS this service was configured with (Section 17:
    asymmetric verification, no network fetch - same static-value pattern
    every other self-hosted Supabase service already uses for JWT_JWKS).
    Returns None for "nothing configured" or "couldn't parse it", both of
    which mean the same thing to verify_jwt: fall back to the plain
    secret."""
    if not jwks_json:
        return None
    try:
        # Raises PyJWKSetError (not a PyJWKError) for an empty "keys"
        # list, on top of the usual malformed-JSON cases - broad except
        # is deliberate, every PyJWT parse/validation failure here means
        # the same thing: nothing usable was configured.
        return jwt.PyJWKSet.from_json(jwks_json)
    except (jwt.PyJWTError, ValueError):
        return None


def _decode_via_jwks(token: str, jwk_set: jwt.PyJWKSet) -> dict | None:
    """Verify against whichever JWKS entry matches the token's `kid`.
    The verification algorithm always comes from the matched JWK's own
    metadata, never from the token's own (attacker-controlled) `alg`
    header - the standard defense against algorithm-confusion attacks.
    Returns None for "couldn't verify this way" (no match, or signature/
    claims failed against the matched key) so the caller can fall back to
    the legacy secret path; a token that's actually forged fails there
    too, so falling through here never bypasses verification."""
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError:
        return None

    matched = next((k for k in jwk_set.keys if k.key_id == kid), None)
    if matched is None:
        return None

    try:
        return jwt.decode(
            token, key=matched.key, algorithms=[matched.algorithm_name], audience="authenticated"
        )
    except jwt.PyJWTError:
        return None


def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    token = credentials.credentials

    jwk_set = _load_jwk_set(_get_jwks_json())
    if jwk_set is not None:
        payload = _decode_via_jwks(token, jwk_set)
        if payload is not None:
            return payload["sub"]
        # Falls through to the legacy secret below - covers a token
        # issued before a key rotation (Section 17's "planned key-
        # rotation window": old HS256 tokens stay valid through their
        # natural expiry rather than being invalidated the moment JWKS
        # is configured).

    try:
        payload = jwt.decode(
            token, _get_jwt_secret(), algorithms=["HS256"], audience="authenticated"
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
    return payload["sub"]


def _hash_api_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _verify_api_token(token: str) -> str:
    """Look up a personal access token by its hash - only the hash is
    ever stored (0008_api_tokens.sql), so a leaked database dump doesn't
    hand out usable tokens. Touches the database on every call (unlike
    verify_jwt's pure signature check), acceptable for this token's
    actual usage pattern: low-frequency scripted capture creation, not
    every request the app makes."""
    token_hash = _hash_api_token(token)
    conn = None
    try:
        conn = psycopg.connect(get_settings().database_url)
        with conn.cursor() as cur:
            cur.execute(
                "select user_id from api_tokens where token_hash = %s and revoked_at is null",
                (token_hash,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or revoked API token",
                )
            user_id = str(row[0])
            cur.execute(
                "update api_tokens set last_used_at = now() where token_hash = %s", (token_hash,)
            )
        conn.commit()
    finally:
        if conn:
            conn.close()
    return user_id


def verify_jwt_or_api_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    """Accepts either a normal Supabase session JWT or a long-lived API
    token (Section 17's public API) - deliberately used only on the
    narrow capture-creation endpoint this feature is actually for
    (apps/api/routers/captures.py's POST /captures), not swapped in for
    verify_jwt everywhere."""
    if credentials.credentials.startswith(API_TOKEN_PREFIX):
        return _verify_api_token(credentials.credentials)
    return verify_jwt(credentials)
