import {
  serveDir,
  serveFile,
} from "https://deno.land/std@0.207.0/http/file_server.ts";

function getRandomString(s: number) {
  if (s % 2 == 1) {
    throw new Deno.errors.InvalidData("Only even sizes are supported");
  }
  const buf = new Uint8Array(s / 2);
  crypto.getRandomValues(buf);
  let ret = "";
  for (let i = 0; i < buf.length; ++i) {
    ret += ("0" + buf[i].toString(16)).slice(-2);
  }
  return ret;
}

class Room {
  constructor(socket, rooms, emit, id) {
    this.sockets = [];
    if (!id) {
      this.id = getRandomString(6);
    } else {
      this.id = id;
    }
    socket.roomId = this.id;
    this.messages = {
      [socket.id]: [""],
    };
    this.rooms = rooms;
    this.rooms.newRoom(this);
    this.join(socket);
    this.nonEvents = [
      "Shift",
      "Meta",
      "Control",
      "Alt",
      "Enter",
      "Escape",
      "Backspace",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Tab",
      "Delete",
      "DeleteAt",
      "CtrlA",
      "CtrlE",
      "CtrlK",
      "CtrlB",
      "CtrlF"
    ];
  }
  join(socket) {
    console.log(
      `socket id ${socket.id} joining room ${this.id}, there are already ${this.sockets.length} sockets connected`,
    );
    // Allow up to 4 participants (adjust number as needed)
    if (this.sockets.length >= 4) {
      return socket.json({ type: "room-is-crowded", message: "Room is full (max 4 participants)." });
    }
    this.sockets.push(socket);
    if (this.sockets.length == 2) {
      console.log(`room ${this.id} started chatting`);
    }
    if (!this.messages[socket.id]) {
      this.messages[socket.id] = [""];
    }
    if (!this.messages[socket.id]?.slice(-2)[0]?.includes("has joined")) {
      this.messages[socket.id].push(
        `> socket id ${socket.id} has joined at ${new Date().toISOString().replace('T', ' ').split('.')[0] + "Z"
        }`,
      );
      this.messages[socket.id].push("");
    }
    this.message(
      socket,
      (sock) => ({ type: "gotRoom", room: this.render(sock.id) }),
      true,
    );
  }
  leave(id) {
    this.sockets = this.sockets.filter((socket) => socket.id !== id);
    this.messages[id].push(
      `> socket id ${id} has left at ${new Date().toISOString().replace('T', ' ').split('.')[0] + "Z"
      }`,
    );
    this.messages[id].push("");
    if (this.sockets.length == 1) {
      console.log(`room ${this.id} stopped chatting`);
    }
    if (this.sockets.length === 0) {
      rooms.removeRoom(this);
    }
    this.message(
      { id },
      (sock) => ({ type: "gotRoom", room: this.render(sock.id) }),
      true,
    );
  }
  message = (socket, msg, broadcast) => {
    this.rooms.setLastUpdate();
    if (broadcast) {
      this.sockets.map((sock) => sock.json(msg(sock)));
      return;
    }
    // Send message to all *other* sockets in the room
    this.sockets.forEach((sock) => {
      if (sock?.id !== socket?.id) {
        // If msg is a function, call it for each sock, otherwise send the object
        sock.json(typeof msg === 'function' ? msg(sock) : msg);
      }
    });
  };
  render(socketId) {
    // Get IDs of all other participants
    const otherIds = this.sockets
      .filter((sock) => sock.id !== socketId)
      .map(sock => sock.id);
    return {
      messages: this.messages,
      participants: this.sockets.length,
      id: this.id,
      yourId: socketId,
      // Keep 'theirId' for potential backward compatibility or simple cases,
      // but also include all other IDs. Client might need adjustment.
      theirId: otherIds.length > 0 ? otherIds[0] : undefined, // Example: first other participant
      otherParticipantIds: otherIds, // List of all other participant IDs
    };
  }
  keyPress(socket, key, cursorPos) {
    // console.log(`socket ${socket.id} pressed key ${key} in room ${this.id}`);
    if (key === "Enter") {
      this.message(socket, {
        type: "committed",
        final: this.messages[socket.id][this.messages[socket.id].length - 1],
        source: socket.id,
      });
      this.messages[socket.id].push("");
      return;
    }
    
    // For all keys, broadcast to other clients (including cursor position)
    this.message(socket, { 
      type: "keyPress", 
      key, 
      source: socket.id,
      cursorPos: cursorPos
    });
    
    // For non-arrow keys, update our local state
    const ourMessages = this.messages[socket.id];
    const currentLine = ourMessages.slice(-1)[0];
    
    if (key === "CtrlK" && cursorPos !== undefined) {
      // Control+K: Delete from cursor to end of line
      const newLine = currentLine.slice(0, cursorPos);
      ourMessages.splice(-1, 1, newLine);
    } else if (key === "DeleteAt" && cursorPos !== undefined) {
      // Delete at cursor position
      if (cursorPos < currentLine.length) {
        const newLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
        ourMessages.splice(-1, 1, newLine);
      }
    } else if (key === "Delete" && cursorPos !== undefined) {
      // Delete at cursor position
      if (cursorPos < currentLine.length) {
        const newLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
        ourMessages.splice(-1, 1, newLine);
      }
    } else if (key === "Backspace" && cursorPos !== undefined && cursorPos > 0) {
      // Apply backspace at cursor position
      const newLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
      ourMessages.splice(-1, 1, newLine);
    } else if (key === "Space" && cursorPos !== undefined) {
      // Apply space at cursor position
      const newLine = currentLine.slice(0, cursorPos) + " " + currentLine.slice(cursorPos);
      ourMessages.splice(-1, 1, newLine);
    } else if (!this.nonEvents.includes(key) && cursorPos !== undefined) {
      // Add regular character at cursor position
      const newLine = currentLine.slice(0, cursorPos) + key + currentLine.slice(cursorPos);
      ourMessages.splice(-1, 1, newLine);
    }
    // We don't need to handle CtrlA, CtrlE, CtrlB, CtrlF on the server as they only affect cursor position
    // We don't update local state for arrow keys since they only affect cursor position
  }
}
class Rooms {
  constructor() {
    this.rooms = {};
    this.writing = false;
    this.lastUpdatedState = 0;
    this.lastWrote = 0;
    try {
      const decoder = new TextDecoder("utf-8");
      const data = Deno.readFileSync("./rooms.json");
      this.cachedRooms = JSON.parse(decoder.decode(data));
    } catch (e) {
      console.log("no rooms.json present, setting cachedRooms to empty object");
      this.cachedRooms = {};
    }
    setInterval(this.writeRooms, 10000);
  }
  setLastUpdate = (force) => {
    if (force) {
      this.lastUpdatedState = force;
      return;
    }
    this.lastUpdatedState = Date.now();
  };
  writeRooms = async () => {
    if (this.writing === false && this.lastWrote < this.lastUpdatedState) {
      console.log(
        "changes have been made since the last write, caching undeleted conversations",
      );
      this.writing = true;
      const rooms = Object.keys(this.rooms).reduce((acc, id) => ({
        ...acc,
        [id]: this.rooms[id].messages,
      }), {});
      try {
        await Deno.writeTextFile("./rooms.json", JSON.stringify(rooms));
        this.writing = false;
        this.lastWrote = Date.now();
      } catch (e) {
        console.log("error", e);
        this.writing = false;
      }
    }
  };
  newRoom(room) {
    this.rooms[room.id] = room;
    if (this.cachedRooms[room.id]) {
      room.messages = this.cachedRooms[room.id];
    }
    if (this[`${room.id}timer`]) {
      clearTimeout(this[`${room.id}timer`]);
    }
  }
  removeRoom(room) {
    const id = room.id.slice();
    // if a conversation is abandoned for 12 hours, forget about it completely
    this[`${room.id}timer`] = setTimeout(() => this.deleteRoom(id), 43200000);
  }
  deleteRoom(room) {
    // completley nukes a room, called after 12 hours abandoned
    delete this.rooms[room];
    delete this.cachedRooms[room];
    this.setLastUpdate();
    console.log(
      `room ${room} deleted permanently. ${Object.keys(this.rooms).length
      } remain`,
    );
  }
  reviveRoom(room) {
    // someone rejoined empty room, check if cache has messages in case servers been restarted
    if (this.cachedRooms[room.id]) {
      room.messages = this.cachedRooms[room.id];
    }
    // clear timer if room was slotted to be deleted
    if (this[`${room.id}timer`]) {
      console.log("removed room", room.id, "deletion timer, someone rejoined.");
      clearTimeout(this[`${room.id}timer`]);
    }
  }
}
const rooms = new Rooms();

Deno.serve({ hostname: "0.0.0.0", port: 8090 }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === '/ws') {
    if (req.headers.get("upgrade") != "websocket") {
      return new Response(null, { status: 501 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.addEventListener("open", () => {
      console.log("a client connected!");
    });
    socket.json = (obj) => {
      socket.send(JSON.stringify(obj));
    };
    socket.addEventListener("close", () => {
      console.log(`socket id ${socket.id} closed, leaving room ${socket.roomId}`);
      rooms.rooms[socket.roomId]?.leave(socket.id);
    });
    socket.addEventListener("message", (event) => {
      const body = JSON.parse(event.data);
      switch (body.type) {
        case "newroom":
          // fresh connection
          if (!body.socketId) {
            socket.id = getRandomString(20);
          } else {
            // buddy had a id from localstorage
            socket.id = body.socketId;
          }
          new Room(socket, rooms, "roomCreated");
          break;
        case "fetchRoom":
          if (!rooms.rooms[body.id]) {
            if (!body.socketId) {
              // todo: dry
              socket.id = getRandomString(20);
            } else {
              socket.id = body.socketId;
            }
            console.log("socket requested nonexistent room, creating one");
            // someone went to a url that did't have a room ready, make one on the fly
            const room = new Room(socket, rooms, "gotRoom", body.id);
            socket.roomId = room.id;
          } else {
            // todo: dry
            if (!body.socketId) {
              socket.id = getRandomString(20);
            } else {
              socket.id = body.socketId;
            }
            // joining room that exists
            const joined = rooms.rooms[body.id].join(socket);
            socket.roomId = body.id;
            if (joined) {
              rooms.reviveRoom(body);
            }
          }
          break;
        case "keyPress":
          // someone pushed a button
          rooms.rooms[socket.roomId].keyPress(socket, body.key, body.cursorPos);
      }
    });
    return response;
  } else {
    const pathname = new URL(req.url).pathname;

    if (pathname.startsWith("/gui")) {
      return serveDir(req, {
        fsRoot: "gui",
        urlRoot: "gui",
      });
    } else {
      return serveFile(req, "gui/index.html");
    }
  }
});
