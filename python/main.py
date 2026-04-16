"""GeoMCP Python CLI entrypoint.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from functools import wraps
from pathlib import Path
from typing import Awaitable, Callable, ParamSpec, TypeVar, cast, overload

import httpx

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

import python.core.nominatim as nominatim
from python.utils.models import NominatimData, TransferTypes, is_list_of_str

P = ParamSpec("P")
T = TypeVar("T", bound=TransferTypes.Data)

SyncBridgeHandler = Callable[P, TransferTypes.Data]
AsyncBridgeHandler = Callable[P, Awaitable[TransferTypes.Data]]
SyncDecoratedHandler = Callable[P, TransferTypes.ApiDataResponse]
AsyncDecoratedHandler = Callable[P, Awaitable[TransferTypes.ApiDataResponse]]


class PythonBridgeApp:
    """Python bridge 入口控制器。"""
    @staticmethod
    def read_payload() -> tuple[TransferTypes.Action, TransferTypes.Data]:
        """从 stdin 读取并解析 JSON 请求。"""
        raw_payload = sys.stdin.read().strip()

        if not raw_payload:
            raise TransferTypes.AppError("INVALID_INPUT", "stdin payload is required")

        try:
            payload:TransferTypes.ApiRequestData = json.loads(raw_payload)
        except json.JSONDecodeError as error:
            raise TransferTypes.AppError("INVALID_JSON","stdin payload must be valid json",str(error))

        if not isinstance(payload, dict):  # bridge 顶层只接受 JSON object
            raise TransferTypes.AppError("INVALID_INPUT","stdin payload must be a json object")
        
        if payload['data'] is None or not isinstance(payload['data'], dict):  # data 字段如果存在，必须是 JSON object
            raise TransferTypes.AppError("INVALID_INPUT","data field must be a json object if provided")

        return payload['action'], payload['data']
    
    @staticmethod
    def return_response_success(response: TransferTypes.Data) -> TransferTypes.ApiDataResponse:
        """把成功结果包装成统一 bridge 成功响应。"""
        if isinstance(response, dict):
            return {"ok": True, "data": response, "error": None}

        return {"ok": True, "data": response.to_dict(), "error": None}

    @staticmethod
    def normalize_exception(error: Exception) -> TransferTypes.AppError:
        """把运行时异常统一收敛成结构化异常。"""
        if isinstance(error, TransferTypes.AppError):
            return error

        if isinstance(error, httpx.HTTPError):
            return TransferTypes.AppError("UPSTREAM_HTTP_ERROR","failed to fetch location candidates from Nominatim",str(error))

        return TransferTypes.AppError("INTERNAL_ERROR","unexpected python processing error",str(error))

    @staticmethod
    def return_response_error(error: Exception) -> TransferTypes.ApiDataResponse:
        """把异常包装成统一 bridge 错误响应。"""
        app_error = PythonBridgeApp.normalize_exception(error)
        return {"ok": False, "data": None, "error": app_error.to_dict()}

    @staticmethod
    @overload
    def return_repponse_decorator(func: SyncBridgeHandler[P]) -> SyncDecoratedHandler[P]: ...

    @staticmethod
    @overload
    def return_repponse_decorator(func: AsyncBridgeHandler[P]) -> AsyncDecoratedHandler[P]: ...

    @staticmethod
    def return_repponse_decorator(
        func: SyncBridgeHandler[P] | AsyncBridgeHandler[P]
    ) -> SyncDecoratedHandler[P] | AsyncDecoratedHandler[P]:
        """装饰器：统一做成功响应包装与异常包装。"""
        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def async_inner(*args: P.args, **kwargs: P.kwargs) -> TransferTypes.ApiDataResponse:
                try:
                    result = await cast(AsyncBridgeHandler[P], func)(*args, **kwargs)
                    return PythonBridgeApp.return_response_success(result)
                except Exception as error:
                    return PythonBridgeApp.return_response_error(error)
            return cast(AsyncDecoratedHandler[P], async_inner)
        else:
            @wraps(func)
            def sync_inner(*args: P.args, **kwargs: P.kwargs) -> TransferTypes.ApiDataResponse:
                try:
                    result = cast(SyncBridgeHandler[P], func)(*args, **kwargs)
                    return PythonBridgeApp.return_response_success(result)
                except Exception as error:
                    return PythonBridgeApp.return_response_error(error)
            return cast(SyncDecoratedHandler[P], sync_inner)

class MainHandler:
    @staticmethod
    @PythonBridgeApp.return_repponse_decorator
    def handle_location_search(data: TransferTypes.Data):
        """基础定位搜索确认请求"""
        if not isinstance(data, dict):
            raise TransferTypes.AppError("INVALID_DATA", "Expected object data for search_location action")

        raw_queries = data.get("queries")
        if not isinstance(raw_queries, list):
            raise TransferTypes.AppError("INVALID_DATA", "queries must be a list")

        query_item = raw_queries[0]
        if not isinstance(query_item, dict):
            raise TransferTypes.AppError("INVALID_DATA", "query item must be an object")

        query = query_item.get("query")
        if not isinstance(query, str) or not query.strip():
            raise TransferTypes.AppError("INVALID_DATA", "query must be a non-empty string")

        country_codes = query_item.get("country_codes")
        if country_codes is not None:
            if not is_list_of_str(country_codes):
                raise TransferTypes.AppError("INVALID_DATA", "country_codes must be a list of strings")

        search_request = NominatimData.SearchRequest(
            queries=[
                NominatimData.LocationQuery(
                    query=query.strip(),
                    country_codes=country_codes
                )
            ]
        )

        return nominatim.query_requset(search_request)

    # @PythonBridgeApp.return_repponse_decorator
    # def handle_tool_a(self, data: TransferTypes.Data) :
    #     pass

    # @PythonBridgeApp.return_repponse_decorator
    # def handle_tool_b(self, data: TransferTypes.Data) :
    #     pass

    @staticmethod
    def dispatch() -> TransferTypes.ApiDataResponse:
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
    # return asyncio.run(PythonBridgeApp().run_async())
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
