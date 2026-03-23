import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";

interface UserData {
  id: string;
  name: string;
}

interface RoomData {
  hostId: string;
  settings: {
    allowScreenShare: boolean;
    allowRecord: boolean;
    waitingRoom: boolean;
  };
  users: Map<string, UserData>;
  waitingUsers: Map<string, UserData>;
  screenSharingUsers?: Set<string>;
}

const rooms = new Map<string, RoomData>();

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_CREDENTIAL_ID) {
      res.json({ success: true });
    } else {
      res.status(401).json({ success: false, message: "Sai mật khẩu" });
    }
  });

  // Socket.io signaling
  io.on("connection", (socket) => {
    socket.on("join-room", (roomId, userName, password) => {
      let room = rooms.get(roomId);
      const isHost = process.env.ADMIN_CREDENTIAL_ID && password === process.env.ADMIN_CREDENTIAL_ID;

      if (!room) {
        if (!isHost) {
          socket.emit("room-error", "Phòng không tồn tại hoặc bạn không có quyền tạo phòng.");
          return;
        }
        room = {
          hostId: socket.id,
          settings: { allowScreenShare: true, allowRecord: true, waitingRoom: true },
          users: new Map(),
          waitingUsers: new Map(),
          screenSharingUsers: new Set()
        };
        rooms.set(roomId, room);
      }

      const user = { id: socket.id, name: userName || "Khách" };

      if (!isHost && room.hostId !== socket.id && room.settings.waitingRoom) {
        room.waitingUsers.set(socket.id, user);
        socket.emit("waiting-for-host");
        io.to(room.hostId).emit("guest-waiting", user);
      } else {
        room.users.set(socket.id, user);
        socket.join(roomId);

        // Send current room info to the new user
        socket.emit("room-info", {
          hostId: room.hostId,
          settings: room.settings,
          users: Array.from(room.users.values()),
          screenSharingUsers: Array.from(room.screenSharingUsers || [])
        });

        // Notify others
        socket.to(roomId).emit("user-connected", socket.id, user);
      }

      socket.on("disconnect", () => {
        if (room) {
          if (room.waitingUsers.has(socket.id)) {
            room.waitingUsers.delete(socket.id);
            io.to(room.hostId).emit("guest-left-waiting", socket.id);
          } else if (room.users.has(socket.id)) {
            room.users.delete(socket.id);
            if (room.screenSharingUsers) {
              room.screenSharingUsers.delete(socket.id);
            }
            if (room.users.size === 0) {
              rooms.delete(roomId);
            } else if (room.hostId === socket.id) {
              // Reassign host
              room.hostId = Array.from(room.users.keys())[0];
              io.to(roomId).emit("host-changed", room.hostId);
            }
            socket.to(roomId).emit("user-disconnected", socket.id);
          }
        }
      });

      // WebRTC signaling
      socket.on("offer", (offer, toId) => {
        socket.to(toId).emit("offer", offer, socket.id);
      });

      socket.on("answer", (answer, toId) => {
        socket.to(toId).emit("answer", answer, socket.id);
      });

      socket.on("ice-candidate", (candidate, toId) => {
        socket.to(toId).emit("ice-candidate", candidate, socket.id);
      });

      // Chat messaging
      socket.on("chat-message", (message, roomId) => {
        socket.to(roomId).emit("chat-message", message, socket.id);
      });

      // Agenda and Timer
      socket.on("update-agenda", (agenda, roomId) => {
        socket.to(roomId).emit("update-agenda", agenda);
      });

      socket.on("update-timer", (timerData, roomId) => {
        socket.to(roomId).emit("update-timer", timerData);
      });

      // User and Room Settings
      socket.on("update-name", (newName, roomId) => {
        const room = rooms.get(roomId);
        if (room) {
          const user = room.users.get(socket.id);
          if (user) {
            user.name = newName;
            io.to(roomId).emit("user-updated", user);
          }
        }
      });

      socket.on("update-settings", (newSettings, roomId) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          const wasWaitingRoomEnabled = room.settings.waitingRoom;
          room.settings = { ...room.settings, ...newSettings };
          io.to(roomId).emit("settings-updated", room.settings);

          // If waiting room is turned off, admit all waiting users
          if (wasWaitingRoomEnabled && !room.settings.waitingRoom) {
            for (const [userId, user] of room.waitingUsers.entries()) {
              room.waitingUsers.delete(userId);
              room.users.set(userId, user);
              
              io.to(room.hostId).emit("guest-left-waiting", userId);

              const targetSocket = io.sockets.sockets.get(userId);
              if (targetSocket) {
                targetSocket.join(roomId);
                targetSocket.emit("room-info", {
                  hostId: room.hostId,
                  settings: room.settings,
                  users: Array.from(room.users.values())
                });
                targetSocket.to(roomId).emit("user-connected", userId, user);
              }
            }
          }
        }
      });

      socket.on("force-mute", (targetUserId, roomId) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          io.to(targetUserId).emit("force-muted");
        }
      });

      socket.on("force-audio", (targetUserId, roomId, isMuted) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          io.to(targetUserId).emit("force-audio-state", isMuted);
        }
      });

      socket.on("force-video", (targetUserId, roomId, isVideoOff) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          io.to(targetUserId).emit("force-video-state", isVideoOff);
        }
      });

      socket.on("media-state-change", (roomId, state) => {
        const room = rooms.get(roomId);
        if (room) {
          const user = room.users.get(socket.id);
          if (user) {
            room.users.set(socket.id, { ...user, ...state });
          }
        }
        socket.to(roomId).emit("user-media-state", socket.id, state);
      });

      socket.on("raise-hand", (isRaised, roomId) => {
        socket.to(roomId).emit("hand-raised", socket.id, isRaised);
      });

      socket.on("screen-sharing", (isSharing, roomId) => {
        const room = rooms.get(roomId);
        if (room) {
          if (!room.screenSharingUsers) room.screenSharingUsers = new Set();
          if (isSharing) {
            room.screenSharingUsers.add(socket.id);
          } else {
            room.screenSharingUsers.delete(socket.id);
          }
        }
        socket.to(roomId).emit("user-screen-sharing", socket.id, isSharing);
      });

      socket.on("destroy-room", (roomId) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          socket.to(roomId).emit("room-destroyed");
          rooms.delete(roomId);
        }
      });

      socket.on("admit-user", (userId, roomId) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          const user = room.waitingUsers.get(userId);
          if (user) {
            room.waitingUsers.delete(userId);
            room.users.set(userId, user);
            
            io.to(room.hostId).emit("guest-left-waiting", userId);

            const targetSocket = io.sockets.sockets.get(userId);
            if (targetSocket) {
              targetSocket.join(roomId);
              targetSocket.emit("room-info", {
                hostId: room.hostId,
                settings: room.settings,
                users: Array.from(room.users.values()),
                screenSharingUsers: Array.from(room.screenSharingUsers || [])
              });
              targetSocket.to(roomId).emit("user-connected", userId, user);
            }
          }
        }
      });

      socket.on("reject-user", (userId, roomId) => {
        const room = rooms.get(roomId);
        if (room && room.hostId === socket.id) {
          room.waitingUsers.delete(userId);
          io.to(room.hostId).emit("guest-left-waiting", userId);
          const targetSocket = io.sockets.sockets.get(userId);
          if (targetSocket) {
            targetSocket.emit("room-rejected");
          }
        }
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
