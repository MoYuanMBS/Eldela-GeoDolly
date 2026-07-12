"""Overpass 请求、重试与响应校验。"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import logging
import math
from typing import Any, cast

import httpx

from python.utils.config_loader import config
from python.utils.models import JsonDictType, TransferTypes

warning_logger = logging.getLogger("geomcp.warning")
_MAX_ERROR_RESPONSE_TEXT = 2000
_MAX_ERROR_QUERY_PREVIEW = 500


def _response_header(response: httpx.Response, name: str) -> str | None:
    """兼容测试 response 与 httpx.Response 地读取单个响应头。"""
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    value = headers.get(name)
    return str(value) if value is not None else None


def _response_text(response: httpx.Response) -> str | None:
    """读取有限长度的错误正文，避免 debug details 过大。"""
    try:
        text = getattr(response, "text", None)
    except RuntimeError:
        return None
    if not isinstance(text, str) or not text:
        return None
    return text[:_MAX_ERROR_RESPONSE_TEXT]


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """把 Retry-After 的秒数或 HTTP-date 转换为等待秒数。"""
    retry_after = _response_header(response, "Retry-After")
    if retry_after is None:
        return None
    try:
        seconds = float(retry_after)
        return seconds if math.isfinite(seconds) and seconds >= 0 else None
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(retry_after)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())


def _retry_wait_seconds(attempt: int, response: httpx.Response | None = None) -> float:
    """计算指数退避；服务器 Retry-After 更长时优先遵守服务器时间。"""
    backoff_seconds = config.overpass.retry_delay_seconds * (2 ** (attempt - 1))
    if response is None:
        return backoff_seconds
    retry_after_seconds = _retry_after_seconds(response)
    return max(backoff_seconds, retry_after_seconds) if retry_after_seconds is not None else backoff_seconds


def _response_error_details(response: httpx.Response, query: str) -> JsonDictType:
    """整理最终 HTTP 错误的有限调试信息。"""
    details: JsonDictType = {
        "http_status": response.status_code,
        "endpoint": str(response.request.url),
        "query_length": len(query),
        "query_preview": query[:_MAX_ERROR_QUERY_PREVIEW]
    }
    retry_after = _response_header(response, "Retry-After")
    if retry_after is not None:
        details["retry_after"] = retry_after
    response_text = _response_text(response)
    if response_text is not None:
        details["response_text"] = response_text
    return details


def _status_error(response: httpx.Response, query: str) -> TransferTypes.AppError:
    """将非成功 HTTP 响应转换为 GeoMCP Overpass 错误。

    本函数只处理重试耗尽或不可重试的最终 HTTP status，并附带有限的
    Query、Retry-After 与响应正文信息，便于本地调试。

    Args:
        response: 已完成但 HTTP status 不属于成功范围的响应。

    Returns:
        包含项目错误码、简洁消息、HTTP status 和 endpoint 的 AppError。
        调用方负责 ``raise`` 返回的异常。
    """
    details = _response_error_details(response, query)
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


def _warn_overpass_retry(reason: str, attempt: int, wait_seconds: float, details: JsonDictType | None = None) -> None:
    """记录 Overpass 请求重试 warning。"""
    log_details: JsonDictType = {
        "status": "retrying",
        "reason": reason,
        "attempt": attempt,
        "max_attempts": config.overpass.retry_attempts + 1,
        "endpoint": config.overpass.endpoint,
        "wait_seconds": wait_seconds
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

    max_attempts = config.overpass.retry_attempts + 1
    for attempt in range(1, max_attempts + 1):
        # Overpass 请求模块内部管理 client 生命周期，对外只暴露 query -> JSON 的爬取能力。
        request_client = httpx.AsyncClient(
            headers={"User-Agent": config.overpass.user_agent},
            timeout=config.overpass.timeout_seconds
        )
        try:
            # 使用 POST 避免较长的 poly / tag 查询受到 URL 长度限制。
            response = await request_client.post(config.overpass.endpoint, data={"data": query})
        except httpx.TransportError as error:
            is_timeout = isinstance(error, httpx.TimeoutException)
            error_code = "overpass_timeout" if is_timeout else "overpass_connection_error"
            error_message = "Overpass request timed out" if is_timeout else "Failed to connect to Overpass"
            if attempt < max_attempts:
                wait_seconds = _retry_wait_seconds(attempt)
                _warn_overpass_retry(error_code, attempt, wait_seconds, {"error": str(error), "query_length": len(query)})
                await asyncio.sleep(wait_seconds)
                continue
            raise TransferTypes.AppError(code=error_code, message=error_message, details={"endpoint": config.overpass.endpoint, "query_length": len(query)}) from error
        finally:
            await request_client.aclose()

        if not response.is_success:
            if attempt < max_attempts and _is_retryable_status(response.status_code):
                wait_seconds = _retry_wait_seconds(attempt, response)
                retry_details: JsonDictType = {"http_status": response.status_code, "query_length": len(query)}
                retry_after = _response_header(response, "Retry-After")
                if retry_after is not None:
                    retry_details["retry_after"] = retry_after
                _warn_overpass_retry("overpass_http_status", attempt, wait_seconds, retry_details)
                await asyncio.sleep(wait_seconds)
                continue
            raise _status_error(response, query)

        try:
            payload: Any = response.json()
        except ValueError as error:
            if attempt < max_attempts:
                wait_seconds = _retry_wait_seconds(attempt)
                _warn_overpass_retry("overpass_invalid_json", attempt, wait_seconds, {"error": str(error), "query_length": len(query)})
                await asyncio.sleep(wait_seconds)
                continue
            raise TransferTypes.AppError(code="overpass_invalid_response", message="Overpass returned invalid JSON") from error
        # Overpass 可能用 2xx + remark 表示运行期失败，必须优先于普通响应结构处理。
        if isinstance(payload, dict) and payload.get("remark"):
            raise TransferTypes.AppError(code="overpass_query_failed", message="Overpass returned a runtime error", details=str(payload["remark"]))
        if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
            raise TransferTypes.AppError(code="overpass_invalid_response", message="Overpass response must contain an elements list")
        return cast(JsonDictType, payload)

    raise TransferTypes.AppError(code="overpass_query_failed", message="Overpass retry attempts exhausted")
