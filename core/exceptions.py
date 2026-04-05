from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from core.logger import get_logger

logger = get_logger(__name__)


class AppException(Exception):
    """应用自定义异常基类"""
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class ConfigError(AppException):
    """配置错误"""
    def __init__(self, message: str):
        super().__init__(message, status.HTTP_500_INTERNAL_SERVER_ERROR)


class AuthenticationError(AppException):
    """认证错误"""
    def __init__(self, message: str = "认证失败"):
        super().__init__(message, status.HTTP_401_UNAUTHORIZED)


async def app_exception_handler(request: Request, exc: AppException):
    """处理应用自定义异常"""
    logger.error(f"应用异常: {exc.message}", exc_info=exc)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message}
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理请求验证异常"""
    logger.warning(f"请求验证失败: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": "请求参数验证失败", "details": exc.errors()}
    )


async def general_exception_handler(request: Request, exc: Exception):
    """处理未捕获的异常"""
    logger.exception("未处理的异常", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "服务器内部错误"}
    )
