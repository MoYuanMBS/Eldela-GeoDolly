import uuid
from datetime import datetime

_SESSION_MONTH_CODES = "1234567890ab"

def generate_session_id() -> str:
    """按服务器本地年月与 UUID4 片段生成搜索阶段 Session ID。"""
    current_time = datetime.now()
    year_code = f"{current_time.year % 100:02d}"
    month_code = _SESSION_MONTH_CODES[current_time.month - 1]
    return f"{year_code}{month_code}{uuid.uuid4().hex[:8]}"