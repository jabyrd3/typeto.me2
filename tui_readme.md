# Typeto.me TUI Client

This directory contains a Python-based terminal (curses) client for the Typeto.me chat application.
It connects to the same WebSocket backend as the web client (e.g. `wss://typeto.me/ws`) and mirrors its behavior.

---

## Files

- **tui_client.py**: main script implementing the TUI client.
  - Uses `asyncio` + `websockets` for networking.
  - Uses Python’s built-in `curses` for terminal UI.
  - Manages two threads/contexts:
    1. **Network loop** (`network_loop`) running under `asyncio.run` in a background thread.
       - Sends and receives JSON messages over WebSocket.
       - Enqueues incoming messages into `recv_q`.
       - Dequeues outgoing events from `send_q` and transmits them.
    2. **UI loop** (`curses_main`) running under `curses.wrapper` in the main thread.
       - Renders per-participant columns: chat history, in-flight typing, cursor position.
       - Captures keyboard input and translates it to `keyPress` / `committed` events.
       - Pushes outbound events into `send_q`.
  - Shared state: thread-safe `queue.Queue` objects for send/receive.

---

## Requirements

- Python 3.8 or newer
- [websockets](https://pypi.org/project/websockets/) (install via `pip install websockets`)
- A Unix-like terminal with `curses` support. On Windows, install `windows-curses`.

Optional:
- `virtualenv` or `venv` to isolate dependencies.

---

## Installation

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install websockets
   # On Windows: pip install websockets windows-curses
   ```

---

## Usage

```bash
# Create a new room:
python tui_client.py

# Join an existing room:
python tui_client.py ROOM_ID

# Override WebSocket host (e.g. local server):
python tui_client.py ROOM_ID --host ws://localhost:8090/ws
```

Controls:
- **Printable characters**: insert at cursor
- **Enter**: commit current line (sends `committed`)
- **Backspace/Delete**: remove character
- **Arrow keys**: move cursor left/right
- **Ctrl+A / Ctrl+E**: jump to beginning/end
- **Ctrl+K**: delete to end of line
- **Ctrl+B / Ctrl+F**: move cursor left/right
- **Ctrl+D**: delete at cursor
- **Ctrl+C**: exit client

---

## Architecture & Data Flow

1. **Startup**
   - Parse CLI args: optional `room` ID and `--host` URL.
   - Create two `queue.Queue` instances: `send_q`, `recv_q`.
   - Spawn a background thread running `asyncio.run(network_loop(...))`.
   - Enter `curses.wrapper(curses_main, recv_q, send_q)`.

2. **network_loop(uri, room_id, send_q, recv_q)**
   - Connects via `websockets.connect(uri)`.
   - Sends initial JSON: either `newroom` or `fetchRoom`.
   - Maintains `my_id` (server-assigned `socketId`).
   - In a tight loop:
     - Race between `ws.recv()` and blocking `send_q.get()` (via `run_in_executor`).
     - On receive: parse JSON, detect `yourId`, enqueue to `recv_q`.
     - On send: attach `socketId`, send JSON.
     - Cancel the competing task each iteration.
   - On error: enqueue an `error` event and exit.

3. **curses_main(stdscr, recv_q, send_q)**
   - Configure `curses` (no echo, non-blocking input, special keys enabled).
   - Wait for first `gotRoom` or `roomCreated` event to populate:
     - `room_id`, `your_id`, `participants`, and `messages` map.
   - Loop:
     - Drain all pending `recv_q` events, updating `messages` per type:
       - `keyPress`: in-flight line edits
       - `committed`: finalize line, append new blank line
       - re-`gotRoom`/`roomCreated`: full state refresh
       - `error`: display and exit
     - Poll keyboard (`stdscr.getch()`), translate codes to our key constants,
       update local `messages[your_id]`, `cursor_pos`, and enqueue `keyPress`.
     - Redraw screen:
       - Top header bar: Room ID, your short ID, participant count.
       - Horizontal sections (rows) per participant, separated by lines.
       - Each section shows participant ID and latest chat lines.
       - User's section is always at the bottom.
     - Short sleep (~50ms) to throttle redraw.

---

## Known Limitations & Future Work
- **Scrolling/History**: currently shows only the last N lines that fit each section.
- **Window Resizing**: curses does not auto-resize; layout might break on resize. Manual handling missing.
- **Paste Support**: unlike web client, no multi-char paste handling.
- **Reconnection Logic**: no automatic retry if WS drops.
- **Cursor Visibility**: basic block cursor `_` rendered for the user.
- **Color/Themes**: monochrome—could add `curses` color pairs.
- **Input Modes**: consider editable input line vs. full-screen capture.
- **Logging**: integrate verbose/debug logs for network/UI events.
- **Dynamic Height**: Section height is fixed based on initial calculation; doesn't adapt well if terminal resizes or participant count changes drastically.

---

## Development

- Edit `tui_client.py` directly. Follow PEP8 style.
- Use `flake8` or `pylint` for linting.
- Manual test: run two or more clients, type concurrently, verify sync.
- To point at local backend, use `--host ws://localhost:8090/ws`.

Keep this document up-to-date as you extend or refactor the TUI client.
