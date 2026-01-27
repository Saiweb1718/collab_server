import { getRoomId } from "../utils/chat.utils.js";
import { saveMessage } from "./chat.services.js";

module.exports = (io, socket) => {

  // JOIN ROOM
  socket.on("join-room", async ({ type, payload }) => {
    const roomId = getRoomId(type, {
      ...payload,
      companyId: socket.companyId,
      user1: socket.userId,
    });

    socket.join(roomId);
    socket.emit("joined-room", roomId);
  });

  
  socket.on("send-message", async ({ roomId, content }) => {
    const message = await saveMessage({
      roomId,
      senderId: socket.userId,
      content,
    });

    io.to(roomId).emit("receive-message", message);
  });

};
