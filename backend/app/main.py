from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.mybvlife_recovery.router import router as mybvlife_router

app = FastAPI(title="BAOVIET Life Internal API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mybvlife_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    first_error = exc.errors()[0] if exc.errors() else {}
    message = str(first_error.get("msg") or "Dữ liệu không hợp lệ.")
    if "Value error," in message:
        message = message.split("Value error,", 1)[1].strip()
    return JSONResponse(status_code=400, content={"detail": message})


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"ok": True, "service": "BAOVIET Life MyBVLife Recovery API"}
