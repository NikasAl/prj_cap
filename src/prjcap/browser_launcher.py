from __future__ import annotations

import webbrowser


def open_chat(url: str) -> None:
    # Use default browser; new=2 tries to open in a new tab.
    webbrowser.open(url, new=2, autoraise=True)

