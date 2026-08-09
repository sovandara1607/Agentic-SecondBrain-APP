from fastapi import APIRouter, Depends

from core.auth import verify_jwt

router = APIRouter()


@router.get("/me")
def me(user_id: str = Depends(verify_jwt)) -> dict[str, str]:
    return {"user_id": user_id}
