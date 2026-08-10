from datetime import datetime
from typing import Any, Optional
import sys

HEADER_LEN = 60


def _ts() -> str:
    return datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')


def _fmt_duration(ms: float) -> str:
    s = int(ms // 1000)
    m = s // 60
    sec = s % 60
    return f'{m}m {sec}s' if m > 0 else f'{sec}s'


def _meta(**meta) -> str:
    if not meta:
        return ''
    return ' ' + ' '.join(f'{k}={v}' for k, v in meta.items())


class Log:
    def __init__(self, name: str, mode: Optional[str] = None):
        self.name = name
        self.mode = mode
        self._start = __import__('time').time() * 1000

    def header(self):
        date_str = _ts()
        mode_str = f' | {self.mode}' if self.mode else ''
        print(f'\n{"=" * HEADER_LEN}', file=sys.stderr)
        print(f'  {self.name}{mode_str}', file=sys.stderr)
        print(f'  {date_str}', file=sys.stderr)
        print(f'{"=" * HEADER_LEN}\n', file=sys.stderr)

    def section(self, title: str):
        dashes = '-' * max(1, HEADER_LEN - 6 - len(title))
        print(f'── {title} {dashes}', file=sys.stderr)

    def start(self, msg: str, **meta):
        print(f'  \u25b6 {msg}{_meta(**meta)}', file=sys.stderr)

    def success(self, msg: str, **meta):
        print(f'  \u2713 {msg}{_meta(**meta)}', file=sys.stderr)

    def skip(self, msg: str):
        print(f'  \u23ed {msg}', file=sys.stderr)

    def warn(self, msg: str):
        print(f'  \u26a0 {msg}', file=sys.stderr)

    def error(self, msg: str):
        print(f'  \u2717 {msg}', file=sys.stderr)

    def retry(self, msg: str, attempt: int, max_attempts: int):
        print(f'  \u21bb {msg} ({attempt}/{max_attempts})', file=sys.stderr)

    def info(self, msg: str):
        print(f'  \u00b7 {msg}', file=sys.stderr)

    def summary(self, processed: int, errors: int):
        dur = _fmt_duration(__import__('time').time() * 1000 - self._start)
        print(f'\n── SUMMARY {"-" * max(1, HEADER_LEN - 12)}', file=sys.stderr)
        print(f'  Processed: {processed} | Errors: {errors} | Duration: {dur}', file=sys.stderr)
        print(f'{"-" * HEADER_LEN}\n', file=sys.stderr)
