"""GeoMCP Python CLI entrypoint.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from functools import wraps
from pathlib import Path
from typing import Any, Callable

import httpx

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

import python.core.nominatim as nominatim
from python.utils.models import NominatimData, TransferTypes


class PythonBridgeApp:
    """Python bridge 入口控制器。"""
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
        return TransferTypes.BridgeResponse(ok=False, data=None, error=app_error.to_dict())

    @staticmethod
    def return_repponse_decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        """装饰器：统一做成功响应包装与异常包装。"""
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
        if action == "search_location":
            return MainHandler.handle_location_search(data)
        # elif action == "tool_a":
        #     return MainHandler.handle_tool_a(data)
        # elif action == "tool_b":
        #     return MainHandler.handle_tool_b(data)
        else:
            raise TransferTypes.AppError("UNKNOWN_ACTION", f"Unsupported action: {action}")

def main() -> int:
    """同步入口，内部跑 async 主流程。"""
    try:
        response = asyncio.run(MainHandler.dispatch())
        print(json.dumps(response.model_dump(), ensure_ascii=False), flush=True)
        return 0
    except Exception as error:
        print(json.dumps(PythonBridgeApp.return_response_error(error).model_dump()), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
