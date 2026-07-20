"""GeoMCP Python CLI entrypoint.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import sys
from functools import wraps
from typing import Any, Callable

import httpx

import python.core.nominatim as nominatim
from python.utils.models import NominatimData, TransferTypes

event_logger = logging.getLogger("geomcp.event")
warning_logger = logging.getLogger("geomcp.warning")


##### 日志格式 #####

class GeomcpJsonFormatter(logging.Formatter):
    """把 geomcp_extra 合并成一行 JSON 日志。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%d %H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        geomcp_extra = getattr(record, "geomcp_extra", None)
        if isinstance(geomcp_extra, dict):
            payload.update(geomcp_extra)
        elif geomcp_extra is not None:
            payload["extra"] = geomcp_extra
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


##### Bridge 协议处理 #####

class PythonBridgeApp:
    """Python bridge 入口控制器。"""

    ##### 基础环境 #####

    @staticmethod
    def configure_logging() -> None:
        """配置 Python 侧结构化日志，日志走 stderr，避免污染 bridge stdout。"""
        log_level_name = os.getenv("GEOMCP_LOG_LEVEL", "WARNING").upper()
        log_level = getattr(logging, log_level_name, logging.WARNING)
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(GeomcpJsonFormatter())
        logging.basicConfig(
            level=log_level,
            handlers=[handler],
            force=True
        )

    ##### Bridge 输入输出 #####

    @staticmethod
    def read_payload() -> tuple[TransferTypes.Action, TransferTypes.BridgeData]:
        """从 stdin 读取并解析 JSON 请求。"""
        raw_payload = sys.stdin.read().strip()
        try:
            payload = TransferTypes.BridgeRequest.model_validate(json.loads(raw_payload))
        except json.JSONDecodeError as error:
            raise TransferTypes.AppError("INVALID_JSON", "Failed to parse JSON payload", str(error))

        return payload.action, payload.data
    
    @staticmethod
    def return_response_success(response: TransferTypes.BridgeData) -> TransferTypes.BridgeResponse:
        """把成功结果包装成统一 bridge 成功响应。"""
        if isinstance(response, dict):
            return TransferTypes.BridgeResponse(ok=True, data=response, error=None)

        return TransferTypes.BridgeResponse(ok=True, data=response.to_dict(), error=None)

    ##### 异常处理 #####

    @staticmethod
    def normalize_exception(error: Exception) -> TransferTypes.AppError:
        """把运行时异常统一收敛成结构化异常。"""
        if isinstance(error, TransferTypes.AppError):
            return error

        if isinstance(error, httpx.HTTPError):
            return TransferTypes.AppError("UPSTREAM_HTTP_ERROR","failed to fetch location candidates from Nominatim",str(error))

        return TransferTypes.AppError("INTERNAL_ERROR","unexpected python processing error",str(error))

    @staticmethod
    def return_response_error(error: Exception) -> TransferTypes.BridgeResponse:
        """把异常包装成统一 bridge 错误响应。"""
        app_error = PythonBridgeApp.normalize_exception(error)
        warning_logger.warning(
            "bridge_error_response",
            extra={"geomcp_extra": {"status": "failed", "error_code": app_error.code, "reason": app_error.message}}
        )
        return TransferTypes.BridgeResponse(ok=False, data=None, error=app_error.to_dict())

    ##### Handler 包装 #####

    @staticmethod
    def return_repponse_decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        """装饰器：统一做成功响应包装与异常包装。"""
        # 同步和异步 handler 保持原调用方式，仅统一收敛返回与异常。
        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def async_inner(*args: Any, **kwargs: Any) -> TransferTypes.BridgeResponse:
                try:
                    result = await func(*args, **kwargs)
                    return PythonBridgeApp.return_response_success(result)
                except Exception as error:
                    return PythonBridgeApp.return_response_error(error)
            return async_inner
        else:
            @wraps(func)
            def sync_inner(*args: Any, **kwargs: Any) -> TransferTypes.BridgeResponse:
                try:
                    result = func(*args, **kwargs)
                    return PythonBridgeApp.return_response_success(result)
                except Exception as error:
                    return PythonBridgeApp.return_response_error(error)
            return sync_inner


##### Action 分发 #####

class MainHandler:
    @staticmethod
    @PythonBridgeApp.return_repponse_decorator
    def handle_location_search(data: TransferTypes.BridgeData):
        """基础定位搜索确认请求"""
        search_request = NominatimData.LocSearchQueryReq.model_validate(data)

        return nominatim.query_request(search_request)

    # @PythonBridgeApp.return_repponse_decorator
    # def handle_tool_a(self, data: TransferTypes.Data) :
    #     pass

    # @PythonBridgeApp.return_repponse_decorator
    # def handle_tool_b(self, data: TransferTypes.Data) :
    #     pass

    @staticmethod
    async def dispatch() -> TransferTypes.BridgeResponse:
        """按 action 分发到对应 handler。"""
        action, data = PythonBridgeApp.read_payload()
        event_logger.info("bridge_dispatch", extra={"geomcp_extra": {"action": action, "status": "started"}})
        if action == "search_location":
            return MainHandler.handle_location_search(data)
        # elif action == "tool_a":
        #     return MainHandler.handle_tool_a(data)
        # elif action == "tool_b":
        #     return MainHandler.handle_tool_b(data)
        else:
            raise TransferTypes.AppError("UNKNOWN_ACTION", f"Unsupported action: {action}")


##### CLI 入口 #####

def main() -> int:
    """同步入口，内部跑 async 主流程。"""
    PythonBridgeApp.configure_logging()
    try:
        response = asyncio.run(MainHandler.dispatch())
        event_logger.info("bridge_completed", extra={"geomcp_extra": {"ok": response.ok, "status": "completed"}})
        print(json.dumps(response.model_dump(), ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        print(json.dumps(PythonBridgeApp.return_response_error(error).model_dump()), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
