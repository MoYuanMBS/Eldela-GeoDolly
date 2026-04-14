"""GeoMCP Python CLI entrypoint.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
from functools import wraps
from pathlib import Path
from typing import Any, Awaitable, Callable, cast

import httpx

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from python.core.nominatim import build_search_response
from python.utils.models import JsonDict, JsonValue, LocationQuery, SearchRequest, TransferTypes

BridgeHandler = Callable[..., TransferTypes.Data | Awaitable[TransferTypes.Data]]
DecoratedHandler = Callable[..., TransferTypes.DataToTypeScript | Awaitable[TransferTypes.DataToTypeScript]]


class PythonBridgeApp:
    """Python bridge 入口控制器。"""

    def read_payload(self) -> JsonDict:
        """从 stdin 读取并解析 JSON 请求。"""
        raw_payload = sys.stdin.read().strip()

        if not raw_payload:
            raise TransferTypes.AppError("INVALID_INPUT", "stdin payload is required")

        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError as error:
            raise TransferTypes.AppError("INVALID_JSON","stdin payload must be valid json",str(error))

        if not isinstance(payload, dict):  # bridge 顶层只接受 JSON object
            raise TransferTypes.AppError(
                "INVALID_INPUT",
                "stdin payload must be a json object"
            )

        return cast(JsonDict, payload)

    def return_response_success(self,response: TransferTypes.Data) -> TransferTypes.DataToTypeScript:
        """把成功结果包装成统一 bridge 成功响应。"""
        if isinstance(response, dict):
            return {"ok": True, "data": response, "error": None}

        return {"ok": True, "data": response.to_dict(), "error": None}

    def normalize_exception(self, error: Exception) -> TransferTypes.AppError:
        """把运行时异常统一收敛成结构化异常。"""
        if isinstance(error, TransferTypes.AppError):
            return error

        if isinstance(error, httpx.HTTPError):
            return TransferTypes.AppError("UPSTREAM_HTTP_ERROR","failed to fetch location candidates from Nominatim",str(error))

        return TransferTypes.AppError("INTERNAL_ERROR","unexpected python processing error",str(error)
)

    def return_response_error(self,error: Exception) -> TransferTypes.DataToTypeScript:
        """把异常包装成统一 bridge 错误响应。"""
        app_error = self.normalize_exception(error)
        return {"ok": False, "data": None, "error": app_error.to_dict()}

    @staticmethod
    def return_repponse_decorator(func: BridgeHandler) -> DecoratedHandler:
        """装饰器：统一做成功响应包装与异常包装。"""
        bridge = PythonBridgeApp()
        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def async_inner(*args,**kwargs) -> TransferTypes.DataToTypeScript:
                try:
                    result = await func(*args, **kwargs)
                    return bridge.return_response_success(result)
                except Exception as error:
                    return bridge.return_response_error(error)
            return async_inner
        else:
            @wraps(func)
            def sync_inner(*args,**kwargs) -> TransferTypes.DataToTypeScript:
                try:
                    result = func(*args, **kwargs)
                    return bridge.return_response_success(cast(TransferTypes.Data, result))
                except Exception as error:
                    return bridge.return_response_error(error)
            return sync_inner

    async def dispatch(self, payload: JsonDict) -> TransferTypes.DataToTypeScript:
        """按 action 分发到对应链路。"""
        action = payload.get("action")

        if action == "search_location":
            response = self.handle_search_location(payload)
            if inspect.isawaitable(response):
                return await response
            return response

        raise TransferTypes.AppError(
            "UNKNOWN_ACTION",
            f"unsupported action: {action}",
            cast(JsonValue, action)
        )

    @return_repponse_decorator
    def handle_search_location(self, payload: JsonDict) -> TransferTypes.Data:
        """执行地点搜索链路。"""
        query = str(payload.get("query", "")).strip()
        country_codes = str(payload.get("country_codes", "")).strip()

        if not query:
            raise TransferTypes.AppError("INVALID_INPUT", "query is required")

        search_request = SearchRequest(
            queries=[
                LocationQuery(
                    query=query,
                    country_codes=[country_codes] if country_codes else None,  # 先兼容当前字符串输入
                )
            ]
        )
        return build_search_response(search_request)

    async def run_async(self) -> int:
        """执行一次完整的 stdin -> handler -> stdout 生命周期。"""
        try:
            payload = self.read_payload()
            response = await self.dispatch(payload)
        except Exception as error:
            response = self.return_response_error(error)

        sys.stdout.write(json.dumps(response, ensure_ascii=False))
        return 0 if response.get("ok") else 1


def main() -> int:
    """同步入口，内部跑 async 主流程。"""
    return asyncio.run(PythonBridgeApp().run_async())


if __name__ == "__main__":
    raise SystemExit(main())
