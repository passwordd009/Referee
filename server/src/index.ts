import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import roomRoutes from './routes/rooms.js';
import bitRoutes from './routes/bits.js';
import { registerRoomHandlers } from './socket/roomHandlers.js';
import { registerMatchHandlers } from './socket/matchHandlers.js';
import { registerLaughHandlers } from './socket/laughHandlers.js';
import { matchEngine } from './game/MatchEngine.js';

const app = express();
const httpServer = createServer(app);

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';

const io = new Server(httpServer, {
  cors: { origin: WEB_URL, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: WEB_URL }));
app.use(express.json());

app.use('/api/rooms', roomRoutes);
app.use('/api/bits', bitRoutes);

app.get('/health', (_req, res) => res.json({ ok: true }));

io.on('connection', (socket) => {
  console.log(`[socket] + ${socket.id}`);
  registerRoomHandlers(io, socket);
  registerMatchHandlers(io, socket, matchEngine);
  registerLaughHandlers(io, socket, matchEngine);

  socket.on('disconnect', () => {
    console.log(`[socket] - ${socket.id}`);
  });
});

const PORT = process.env.PORT ?? 3001;
httpServer.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
});
