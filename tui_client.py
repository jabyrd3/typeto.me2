#!/usr/bin/env python3
"""
TUI client for the Typeto.me chat app using curses.

Usage:
  python tui_client.py [ROOM_ID] [--host HOST]

Requirements:
  Python 3.8+
  pip install websockets
"""
import curses
import argparse
import threading
import queue
import json
import time

try:
    import asyncio
    import websockets
except ImportError:
    print("Missing dependencies: install 'websockets' (pip install websockets)")
    exit(1)


def short_id(id_str: str) -> str:
    return id_str[:4]


async def network_loop(uri: str, room_id: str, send_q: queue.Queue, recv_q: queue.Queue):
    """
    Async network thread: connects to WebSocket, sends/receives JSON messages.
    send_q: outgoing events dicts
    recv_q: incoming events dicts
    """
    try:
        async with websockets.connect(uri) as ws:
            # initial handshake: create or fetch room
            if room_id:
                init = {"type": "fetchRoom", "id": room_id}
            else:
                init = {"type": "newroom"}
            await ws.send(json.dumps(init))
            my_id = None
            while True:
                # race between receiving ws and outgoing send_q
                loop = asyncio.get_running_loop()
                recv_task = loop.create_task(ws.recv())
                # schedule send_q.get in executor for non-blocking
                send_task = loop.run_in_executor(None, send_q.get)
                done, pending = await asyncio.wait(
                    [recv_task, send_task], return_when=asyncio.FIRST_COMPLETED
                )
                # handle completed tasks
                for task in done:
                    if task is recv_task:
                        msg = task.result()
                        data = json.loads(msg)
                        # capture our socket id from server
                        if isinstance(data, dict) and data.get("room"):
                            rid = data["room"].get("yourId")
                            if rid:
                                my_id = rid
                        recv_q.put(data)
                    else:
                        # send outgoing event
                        ev = task.result()
                        # attach socketId if known
                        if my_id:
                            ev["socketId"] = my_id
                        await ws.send(json.dumps(ev))
                # cancel pending
                for task in pending:
                    task.cancel()
    except Exception as e:
        # signal error to UI
        recv_q.put({"type": "error", "message": str(e)})


def curses_main(stdscr, recv_q: queue.Queue, send_q: queue.Queue):
    # Curses configuration
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.keypad(True)

    # data structures
    room_id = None
    your_id = None
    participants = []  # order: [you] + others
    messages = {}
    cursor_pos = 0
    # set of keys that do not produce characters
    non_events = {
        "Shift", "Meta", "Control", "Alt", "Enter", "Escape",
        "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp",
        "ArrowDown", "Tab", "Delete", "DeleteAt",
        "CtrlA", "CtrlE", "CtrlK", "CtrlB", "CtrlF"
    }

    # wait for initial room data
    while True:
        try:
            ev = recv_q.get(timeout=0.1)
        except queue.Empty:
            continue
        if ev.get("type") in ("gotRoom", "roomCreated"):
            room = ev["room"]
            room_id = room.get("id")
            your_id = room.get("yourId")
            others = room.get("otherParticipantIds") or []
            # build participant list
            participants = [your_id] + [pid for pid in others if pid != your_id]
            # initialize messages mapping
            messages.clear()
            for pid, lst in room.get("messages", {}).items():
                messages[pid] = list(lst)
            # ensure each has at least a blank line
            for pid in participants:
                messages.setdefault(pid, [""])
            break
        elif ev.get("type") == "error":
            stdscr.clear()
            stdscr.addstr(0, 0, "Network error: " + ev.get("message", ""))
            stdscr.refresh()
            time.sleep(2)
            return

    # main loop
    while True:
        # process all incoming events
        while True:
            try:
                ev = recv_q.get_nowait()
            except queue.Empty:
                break
            etype = ev.get("type")
            if etype == "keyPress":
                src = ev.get("source")
                key = ev.get("key")
                cpos = ev.get("cursorPos")
                # ensure list exists
                messages.setdefault(src, [""])
                cur = messages[src][-1]
                new = cur
                if key == "CtrlK" and cpos is not None:
                    new = cur[:cpos]
                elif key in ("Delete", "DeleteAt") and cpos is not None and cpos < len(cur):
                    new = cur[:cpos] + cur[cpos+1:]
                elif key == "Backspace":
                    if cpos is not None and cpos > 0:
                        new = cur[:cpos-1] + cur[cpos:]
                    else:
                        new = cur[:-1]
                elif key in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"):
                    # no change to text
                    new = cur
                elif key == "Space":
                    if cpos is not None:
                        new = cur[:cpos] + " " + cur[cpos:]
                    else:
                        new = cur + " "
                elif isinstance(key, str) and len(key) == 1 and key not in non_events:
                    if cpos is not None:
                        new = cur[:cpos] + key + cur[cpos:]
                    else:
                        new = cur + key
                # update
                messages[src][-1] = new
            elif etype == "committed":
                src = ev.get("source")
                final = ev.get("final", "")
                lst = messages.setdefault(src, [])
                if lst:
                    lst[-1] = final
                else:
                    lst.append(final)
                lst.append("")
            elif etype in ("gotRoom", "roomCreated"):
                # reinitialize state (e.g. reconnect)
                room = ev["room"]
                room_id = room.get("id")
                your_id = room.get("yourId")
                others = room.get("otherParticipantIds") or []
                participants = [your_id] + [pid for pid in others if pid != your_id]
                messages.clear()
                for pid, lst in room.get("messages", {}).items():
                    messages[pid] = list(lst)
                for pid in participants:
                    messages.setdefault(pid, [""])
            elif etype == "error":
                stdscr.clear()
                stdscr.addstr(0, 0, "Error: " + ev.get("message", ""))
                stdscr.refresh()
                time.sleep(2)
                return

        # handle local key input
        ch = stdscr.getch()
        if ch != -1:
            key = None
            if ch == curses.KEY_LEFT:
                key = "ArrowLeft"
            elif ch == curses.KEY_RIGHT:
                key = "ArrowRight"
            elif ch in (curses.KEY_BACKSPACE, 127, 8):
                key = "Backspace"
            elif ch == curses.KEY_DC:
                key = "Delete"
            elif ch in (10, 13):
                key = "Enter"
            elif ch == 9:
                key = "Tab"
            elif ch == 1:
                key = "CtrlA"
            elif ch == 5:
                key = "CtrlE"
            elif ch == 11:
                key = "CtrlK"
            elif ch == 2:
                key = "CtrlB"
            elif ch == 6:
                key = "CtrlF"
            elif ch == 4:
                key = "DeleteAt"
            elif 0 <= ch < 256:
                c = chr(ch)
                if c.isprintable():
                    key = c
            if key:
                cur = messages[your_id][-1]
                cpos = cursor_pos
                # send to server
                send_q.put({"type": "keyPress", "key": key, "cursorPos": cpos})
                # local update
                if key == "Enter":
                    # commit
                    messages[your_id][-1] = cur
                    messages[your_id].append("")
                    cursor_pos = 0
                else:
                    new = cur
                    if key == "CtrlK":
                        new = cur[:cpos]
                    elif key in ("DeleteAt", "Delete"):
                        if cpos < len(cur):
                            new = cur[:cpos] + cur[cpos+1:]
                    elif key == "Backspace":
                        if cpos > 0:
                            new = cur[:cpos-1] + cur[cpos:]
                            cursor_pos -= 1
                    elif key == "ArrowLeft":
                        cursor_pos = max(0, cursor_pos-1)
                    elif key == "ArrowRight":
                        cursor_pos = min(len(cur), cursor_pos+1)
                    elif key == "Space":
                        new = cur[:cpos] + " " + cur[cpos:]
                        cursor_pos += 1
                    elif len(key) == 1 and key not in non_events:
                        new = cur[:cpos] + key + cur[cpos:]
                        cursor_pos += 1
                    elif key == "CtrlA":
                        cursor_pos = 0
                    elif key == "CtrlE":
                        cursor_pos = len(cur)
                    messages[your_id][-1] = new

        # draw UI panels
        stdscr.erase()
        max_y, max_x = stdscr.getmaxyx()
        # overall header
        hdr = f" Room: {room_id}  You: {short_id(your_id)}  Participants: {len(participants)} "
        stdscr.addnstr(0, 0, hdr, max_x, curses.A_REVERSE)
        # panel layout
        cols = len(participants)
        col_width = max_x // cols if cols else max_x
        # for each participant, draw a column
        for idx, pid in enumerate(participants):
            x0 = idx * col_width
            w = col_width if idx < cols-1 else max_x - x0
            # title row
            title = "You" if pid == your_id else short_id(pid)
            stdscr.addnstr(1, x0, title.center(w), w, curses.A_BOLD)
            # messages
            lst = messages.get(pid, [])
            disp_h = max_y - 2
            to_show = lst[-disp_h:] if len(lst) > disp_h else lst
            for ridx, line in enumerate(to_show):
                y = 2 + ridx
                stdscr.addnstr(y, x0, line.ljust(w)[:w], w, curses.A_NORMAL)
        stdscr.refresh()
        time.sleep(0.05)


def main():
    parser = argparse.ArgumentParser(description="Typeto.me TUI client")
    parser.add_argument("room", nargs="?", help="Room ID to join (omit to create new)")
    parser.add_argument("--host", default="wss://typeto.me/ws", help="WebSocket host URL")
    args = parser.parse_args()
    recv_q = queue.Queue()
    send_q = queue.Queue()
    # start network thread
    thr = threading.Thread(
        target=lambda: asyncio.run(network_loop(args.host, args.room, send_q, recv_q)),
        daemon=True,
    )
    thr.start()
    # start curses UI
    curses.wrapper(lambda scr: curses_main(scr, recv_q, send_q))


if __name__ == "__main__":
    main()