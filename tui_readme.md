# Typeto.me TUI Client

`tui_client.py` is a Python-based terminal (curses) client for the Typeto.me chat application.
It connects to the same WebSocket backend as the web client (e.g. `wss://typeto.me/ws`) and mirrors its behavior.

It was 100% vibe-coded; no human has ever examined its code, so use at your own risk. It appears to mostly work.
(This document was as well, except for this paragraph.)

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
       - Renders one **row per participant** (stacked vertically): chat history,
         in-flight typing and cursor position.
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
 The input line supports the standard *Emacs-style* shortcuts provided by
 GNU Readline (e.g. arrow keys, Ctrl A/E/B/F/K, etc.).  In other words, if
 you are comfortable editing a command line in Bash or Python’s REPL the
 same keys will work here – plus **Ctrl-C** to exit the client.

---

## Architecture & Data Flow

1. **Startup**
   - Parse CLI args: optional `room` ID and `--host` URL.
   - Create two `queue.Queue` instances: `send_q`, `recv_q`.
   - Spawn a background thread running `asyncio.run(network_loop(...))`.
   - Enter `curses.wrapper(curses_main, recv_q, send_q)`.

2. **network_loop(uri, room_id, send_q, recv_q)**
   - Connects via `websockets.connect(uri)` and performs an initial handshake
     (`newroom` or `fetchRoom`).
   - Keeps track of `my_id` (the server-assigned `socketId`).
   - Uses a **single polling loop** – every iteration:
     1. Drain *all* events currently queued in `send_q` with `get_nowait()` and
        forward them to the WebSocket.
     2. Wait for an inbound message with `asyncio.wait_for(ws.recv(),
        timeout=0.05)`. The short timeout keeps the loop responsive without
        busy-waiting.
     3. Parse inbound JSON and put it on `recv_q`.
   - Because only one task is running and the surrounding thread is marked
     as *daemon*, the whole process terminates cleanly when the UI exits – no
     lingering threads.
   - Any exception is caught, transformed into an `{"type": "error"}` event,
     and propagated to the UI for graceful display.

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
 - **Paste Support**: unlike the web client, there is no multi-character paste
   handling – each byte is treated as an individual key press.
 - **Reconnection Logic**: no automatic retry if the WebSocket drops.
 - **Cursor Visibility**: a basic block cursor (`_`) is rendered; could be
   improved with blinking or colour.
 - **Logging**: there is no debug/verbose logging flag yet.

---

## Development

- Edit `tui_client.py` directly. Follow PEP8 style.
- Use `flake8` or `pylint` for linting.
- Manual test: run two or more clients, type concurrently, verify sync.
- To point at local backend, use `--host ws://localhost:8090/ws`.
