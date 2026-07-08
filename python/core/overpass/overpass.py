"""Overpass 请求、重试与响应校验。"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, cast

import httpx

from python.utils.models import JsonDictType, TransferTypes

# Overpass 配置模型接入前暂时使用模块常量，后续统一改从 config loader 获取。
OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"
OVERPASS_USER_AGENT = "geomcp/test"
OVERPASS_TIMEOUT_SECONDS = 60.00
OVERPASS_RETRY_ATTEMPTS = 3
OVERPASS_RETRY_DELAY_SECONDS = 1.00
warning_logger = logging.getLogger("geomcp.warning")


def _status_error(response: httpx.Response) -> TransferTypes.AppError:
    """将非成功 HTTP 响应转换为 GeoMCP Overpass 错误。

    当前阶段不在本函数内执行重试，只根据最终 HTTP status 建立稳定
    错误码。后续加入 retry/backoff 时，仍可复用这里的状态映射。

    Args:
        response: 已完成但 HTTP status 不属于成功范围的响应。

    Returns:
        包含项目错误码、简洁消息、HTTP status 和 endpoint 的 AppError。
        调用方负责 ``raise`` 返回的异常。
    """
    details = {"http_status": response.status_code, "endpoint": str(response.request.url)}
    if response.status_code == 400:
        return TransferTypes.AppError(code=f"overpass_invalid_query_{response.status_code}", message="Overpass rejected the query", details=details)
    if response.status_code == 429:
        return TransferTypes.AppError(code=f"overpass_rate_limited_{response.status_code}", message="Overpass rate limit exceeded", details=details)
    if response.status_code >= 500:
        return TransferTypes.AppError(code=f"overpass_server_error_{response.status_code}", message="Overpass service is unavailable", details=details)
    return TransferTypes.AppError(code=f"overpass_query_failed_{response.status_code}", message="Overpass request failed", details=details)


def _is_retryable_status(status_code: int) -> bool:
    """判断 HTTP 状态码是否适合重试。"""
    return status_code == 429 or status_code >= 500


def _warn_overpass_retry(reason: str, attempt: int, details: JsonDictType | None = None) -> None:
    """记录 Overpass 请求重试 warning。"""
    log_details: JsonDictType = {
        "status": "retrying",
        "reason": reason,
        "attempt": attempt,
        "max_attempts": OVERPASS_RETRY_ATTEMPTS,
        "endpoint": OVERPASS_ENDPOINT,
    }
    if details:
        log_details["details"] = details
    warning_logger.warning("overpass_request_retry", extra={"geomcp_extra": log_details})


async def request_overpass(query: str) -> JsonDictType:
    """异步发送 Overpass QL 并校验 JSON 响应外壳。

    请求使用 POST 的 ``data`` 表单字段提交 QL，以支持较长的 poly 查询。
    client 的创建与关闭由本函数内部负责，避免把 Overpass HTTP 细节暴露给
    外部流程。成功响应必须是 JSON object，且包含 ``elements`` list。
    Overpass 即使返回 2xx，也可能通过 ``remark`` 表示运行期错误，
    因此必须单独检查。

    Args:
        query: 完整且非空的 Overpass QL。

    Returns:
        已通过基础结构校验的原始 Overpass JSON 字典。

    Raises:
        TransferTypes.AppError: 查询为空、连接失败、请求超时、HTTP 状态
            错误、响应不是合法 JSON、缺少 ``elements``，或包含运行期
            ``remark``。
    """
    if not query.strip():
        raise TransferTypes.AppError(code="overpass_invalid_query", message="Overpass query is empty")

    for attempt in range(1, OVERPASS_RETRY_ATTEMPTS + 1):
        # Overpass 请求模块内部管理 client 生命周期，对外只暴露 query -> JSON 的爬取能力。
        request_client = httpx.AsyncClient(
            headers={"User-Agent": OVERPASS_USER_AGENT},
            timeout=OVERPASS_TIMEOUT_SECONDS
        )
        try:
            # 使用 POST 避免较长的 poly / tag 查询受到 URL 长度限制。
            response = await request_client.post(OVERPASS_ENDPOINT, data={"data": query})
        except httpx.TransportError as error:
            is_timeout = isinstance(error, httpx.TimeoutException)
            error_code = "overpass_timeout" if is_timeout else "overpass_connection_error"
            error_message = "Overpass request timed out" if is_timeout else "Failed to connect to Overpass"
            if attempt < OVERPASS_RETRY_ATTEMPTS:
                _warn_overpass_retry(error_code, attempt, {"error": str(error)})
                await asyncio.sleep(OVERPASS_RETRY_DELAY_SECONDS)
                continue
            raise TransferTypes.AppError(code=error_code, message=error_message, details={"endpoint": OVERPASS_ENDPOINT}) from error
        finally:
            await request_client.aclose()

        if not response.is_success:
            if attempt < OVERPASS_RETRY_ATTEMPTS and _is_retryable_status(response.status_code):
                _warn_overpass_retry("overpass_http_status", attempt, {"http_status": response.status_code})
                await asyncio.sleep(OVERPASS_RETRY_DELAY_SECONDS)
                continue
            raise _status_error(response)

        try:
            payload: Any = response.json()
        except ValueError as error:
            if attempt < OVERPASS_RETRY_ATTEMPTS:
                _warn_overpass_retry("overpass_invalid_json", attempt, {"error": str(error)})
                await asyncio.sleep(OVERPASS_RETRY_DELAY_SECONDS)
                continue
            raise TransferTypes.AppError(code="overpass_invalid_response", message="Overpass returned invalid JSON") from error
        # Overpass 可能用 2xx + remark 表示运行期失败，必须优先于普通响应结构处理。
        if isinstance(payload, dict) and payload.get("remark"):
            raise TransferTypes.AppError(code="overpass_query_failed", message="Overpass returned a runtime error", details=str(payload["remark"]))
        if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
            raise TransferTypes.AppError(code="overpass_invalid_response", message="Overpass response must contain an elements list")
        return cast(JsonDictType, payload)

    raise TransferTypes.AppError(code="overpass_query_failed", message="Overpass retry attempts exhausted")
