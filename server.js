const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function getRoom(socket, code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room || !room.players.has(socket.id)) return null;
  return room;
}
function leaveRoom(socket) {
  for (const [code, room] of rooms) {
    if (!room.players.has(socket.id)) continue;
    room.players.delete(socket.id);
    socket.leave(code);
    socket.to(code).emit('peer-left');
    if (room.players.size === 0 || room.hostId === socket.id) rooms.delete(code);
    return;
  }
}

io.on('connection', socket => {
  socket.on('create-room', () => {
    leaveRoom(socket);
    const roomCode = makeCode();
    const room = { hostId: socket.id, players: new Set([socket.id]) };
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit('room-created', { roomCode });
  });

  socket.on('join-room', ({ roomCode } = {}) => {
    leaveRoom(socket);
    const code = String(roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('room-error', { message: 'Комната не найдена. Проверь код.' });
    if (room.players.size >= 2) return socket.emit('room-error', { message: 'В комнате уже два игрока.' });
    room.players.add(socket.id);
    socket.join(code);
    socket.emit('room-joined', { roomCode: code });
    socket.to(code).emit('peer-joined');
  });

  socket.on('start-match', ({ roomCode } = {}) => {
    const room = getRoom(socket, roomCode);
    if (!room || room.hostId !== socket.id || room.players.size !== 2) return;
    socket.to(String(roomCode).toUpperCase()).emit('start-match');
  });

  socket.on('input', data => {
    const room = getRoom(socket, data?.roomCode);
    if (!room || room.hostId === socket.id) return;
    socket.to(String(data.roomCode).toUpperCase()).emit('input', {
      x: clamp(data.x, -1, 1), y: clamp(data.y, -1, 1), sprinting: !!data.sprinting
    });
  });

  socket.on('action', data => {
    const room = getRoom(socket, data?.roomCode);
    if (!room || room.hostId === socket.id) return;
    const allowed = ['switch', 'shoot', 'pass', 'tackle'];
    if (!allowed.includes(data.type)) return;
    socket.to(String(data.roomCode).toUpperCase()).emit('action', {
      type: data.type,
      power: clamp(Number(data.power) || 0.5, 0.25, 1)
    });
  });

  socket.on('snapshot', data => {
    const room = getRoom(socket, data?.roomCode);
    if (!room || room.hostId !== socket.id) return;
    socket.to(String(data.roomCode).toUpperCase()).emit('snapshot', data);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`3D Football server listening on port ${PORT}`);
});
