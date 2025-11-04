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
    Async network thread: connects to the WebSocket and shuttles JSON messages
    back and forth using a *polling* strategy that avoids spawning additional
    worker threads.  This guarantees that, once the single network thread is
    marked as daemon, no non-daemon threads remain alive.  Consequently the
    whole process terminates cleanly after the UI thread ends (e.g. when the
    user presses Ctrl-C).
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

            # Main loop: pull outbound messages from send_q and forward inbound
            # messages from the WebSocket to recv_q.  A small timeout keeps the
            # loop responsive without burning CPU.
            while True:
                # 1. Drain all pending items from the outbound queue.
                while True:
                    try:
                        ev = send_q.get_nowait()
                    except queue.Empty:
                        break
                    else:
                        if my_id:
                            ev["socketId"] = my_id
                        await ws.send(json.dumps(ev))

                # 2. Wait briefly for an incoming message; timeout lets us loop
                #    back to process newly queued outgoing events promptly.
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=0.05)
                except asyncio.TimeoutError:
                    continue  # go back to step 1
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Bubble other errors up to outer except block.
                    raise

                # 3. Handle inbound message.
                try:
                    data = json.loads(msg)
                except json.JSONDecodeError:
                    # Ignore malformed JSON.
                    continue

                # Capture our socket id from server handshake.
                if isinstance(data, dict) and data.get("room"):
                    rid = data["room"].get("yourId")
                    if rid:
                        my_id = rid

                recv_q.put(data)
    except Exception as e:
        # Signal error to UI.
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
            # build participant list (user last)
            participants = [pid for pid in others if pid != your_id] + [your_id]
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
                if not src:
                    continue  # Skip events without a valid source
                key = ev.get("key")
                cpos = ev.get("cursorPos")
                # ensure list exists
                messages.setdefault(src, [""])
                # Safe access to last element
                if not messages[src]:
                    messages[src] = [""]
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
                if not src:
                    continue  # Skip events without a valid source
                final = ev.get("final", "")
                lst = messages.setdefault(src, [])
                if lst and len(lst) > 0:
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
                # build participant list (user last)
                participants = [pid for pid in others if pid != your_id] + [your_id]
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
            # Detect Ctrl-C (ETX / 0x03). In cbreak/raw mode the terminal no longer
            # converts Ctrl-C into SIGINT, instead it is delivered to the program as
            # the character with ASCII code 3.  When running inside curses this means
            # the user previously had to press Ctrl-C twice: the first time produced
            # the character which we ignored, the second time got translated into
            # a real SIGINT once curses had been torn down.  Treat the initial
            # character as an immediate request to exit so a single press is enough.
            if ch == 3:  # Ctrl-C / ^C
                raise KeyboardInterrupt

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
                # Ensure messages list for your_id is not empty
                if not messages.get(your_id):
                    messages[your_id] = [""]
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

        # draw UI sections (rows)
        stdscr.erase()
        max_y, max_x = stdscr.getmaxyx()

        # overall header
        hdr = f" Room: {room_id}  You: {short_id(your_id)}  Participants: {len(participants)} "
        stdscr.addnstr(0, 0, hdr.ljust(max_x), max_x, curses.A_REVERSE)

        # calculate available height per participant section
        num_participants = len(participants)
        # Header uses 1 line, separators use (num_participants - 1) lines
        available_height = max_y - 1 - (num_participants - 1)
        # Each participant gets a title row (1 line) + message lines
        lines_per_participant = max(1, available_height // num_participants - 1) if num_participants > 0 else 0

        current_y = 1  # Start drawing below the header

        for idx, pid in enumerate(participants):
            is_last = (idx == num_participants - 1)
            section_height = lines_per_participant + 1 # +1 for title

            # Draw title row
            title = "You" if pid == your_id else short_id(pid)
            stdscr.addnstr(current_y, 0, title.center(max_x), max_x, curses.A_BOLD)
            current_y += 1

            # Draw messages for this participant
            lst = messages.get(pid, [""])
            # Show the last N lines that fit, including the current typing line.
            to_show = lst[-lines_per_participant:] if len(lst) > lines_per_participant else lst

            # Start drawing so that messages are bottom-aligned within the
            # participant section. When there are fewer lines than the section
            # height, this leaves blank space at the top rather than the
            # bottom, mimicking a typical chat UI where text scrolls upward.
            start_offset = lines_per_participant - len(to_show)

            for line_idx, line in enumerate(to_show):
                draw_y = current_y + start_offset + line_idx
                if draw_y < max_y:  # Ensure we don't write past the screen bottom
                    # Render cursor for self if it's the last line
                    if pid == your_id and line_idx == len(to_show) - 1:
                        # Ensure cursor_pos is within bounds
                        safe_cursor_pos = min(cursor_pos, len(line))
                        # Draw line part before cursor
                        stdscr.addnstr(draw_y, 0, line[:safe_cursor_pos], max_x)
                        # Draw cursor (if space allows)
                        if safe_cursor_pos < max_x:
                            stdscr.addch(draw_y, safe_cursor_pos, '_', curses.A_REVERSE) # Simple block cursor
                        # Draw line part after cursor (if space allows)
                        if safe_cursor_pos + 1 < max_x:
                             stdscr.addnstr(draw_y, safe_cursor_pos + 1, line[safe_cursor_pos+1:], max_x - (safe_cursor_pos + 1))
                    else:
                        stdscr.addnstr(draw_y, 0, line.ljust(max_x)[:max_x], max_x) # Pad/truncate line

            # Advance current_y past the message lines
            current_y += lines_per_participant

            # Draw separator line if not the last participant
            if not is_last and current_y < max_y:
                try:
                    stdscr.hline(current_y, 0, curses.ACS_HLINE, max_x)
                except curses.error:
                    # Fallback if ACS_HLINE fails or goes out of bounds
                    stdscr.addnstr(current_y, 0, '-' * max_x, max_x)
                current_y += 1 # Move past the separator line

        stdscr.refresh()
        time.sleep(0.05) # Keep throttling redraws


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
    # start curses UI. Allow Ctrl-C inside the curses loop to cleanly exit without
    # requiring a second press (handled inside curses_main).
    try:
        curses.wrapper(lambda scr: curses_main(scr, recv_q, send_q))
    except KeyboardInterrupt:
        # Graceful exit – terminal state has already been restored by
        # curses.wrapper, so just fall through to end the program.
        pass


if __name__ == "__main__":
    main()
