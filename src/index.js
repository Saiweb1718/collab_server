import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { app } from './app.js';
import connectToDb from './db/index.js';
import { initSocket } from './chat/socket.js';

const PORT = process.env.PORT || 8000;

const server = http.createServer(app);
initSocket(server);

connectToDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Server + Socket.IO listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to the database:', err.message);
    process.exit(1);
  });
