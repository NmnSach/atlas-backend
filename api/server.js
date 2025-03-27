import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Country, State, City } from 'country-state-city';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

const app = express();
const server = createServer(app);

// Configure allowed origins (update with your Vercel frontend URL)
const allowedOrigins = [
  "https://atlas-six-alpha.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173"
];

// Enable CORS middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));

// Add health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Initialize Socket.IO with proper CORS config
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  path: "/socket.io/",
  transports: ["websocket", "polling"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  io.engine.handleUpgrade(request, socket, head, (ws) => {
    io.engine.emit('connection', ws, request);
  });
});

function isValidPlace(placeName) {
  const normalizedName = placeName.trim().toLowerCase();

  const getFirstWords = (str) => {
    const words = str.split(' ');
    return words.slice(0, 2).join(' ').toLowerCase();
  };

  const countries = Country.getAllCountries();
  if (countries.some(country => getFirstWords(country.name) === getFirstWords(normalizedName))) {
    return true;
  }

  const states = State.getAllStates();
  if (states.some(state => getFirstWords(state.name) === getFirstWords(normalizedName))) {
    return true;
  }

  const cities = City.getAllCities();
  if (cities.some(city => getFirstWords(city.name) === getFirstWords(normalizedName))) {
    return true;
  }

  return false;
}

function createGameRoom() {
  const roomId = uuidv4().substring(0, 6);
  gameRooms[roomId] = {
    players: [],
    history: [],
    currentPlayerIndex: 0,
    letterInPlay: '',
    started: false,
  };
  return roomId;
}

const gameRooms = {};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Connection error handling
  socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
  });

  socket.on('connect_timeout', () => {
    console.error('Connection timeout');
  });

  socket.on('createRoom', (username, callback) => {
    const roomId = createGameRoom();
    socket.join(roomId);

    gameRooms[roomId].players.push({
      id: socket.id,
      username,
      score: 0,
    });

    socket.roomId = roomId;

    callback({
      roomId,
      success: true,
    });

    io.to(roomId).emit('updateRoom', gameRooms[roomId]);
  });

  socket.on('joinRoom', (data, callback) => {
    const { roomId, username } = data;

    if (!gameRooms[roomId]) {
      callback({
        success: false,
        message: 'Room not found',
      });
      return;
    }

    if (gameRooms[roomId].started) {
      callback({
        success: false,
        message: 'Game already started',
      });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;

    gameRooms[roomId].players.push({
      id: socket.id,
      username,
      score: 0,
    });

    callback({
      success: true,
      roomData: gameRooms[roomId],
    });

    io.to(roomId).emit('updateRoom', gameRooms[roomId]);
  });

  socket.on('startGame', () => {
    const roomId = socket.roomId;
    if (!roomId || !gameRooms[roomId]) return;

    const room = gameRooms[roomId];
    room.started = true;
    room.letterInPlay = '';

    io.to(roomId).emit('gameStarted', room);
  });

  socket.on('submitPlace', (placeName) => {
    const roomId = socket.roomId;
    if (!roomId || !gameRooms[roomId]) return;

    const room = gameRooms[roomId];
    const currentPlayer = room.players[room.currentPlayerIndex];

    if (currentPlayer.id !== socket.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    placeName = placeName.trim();

    if (!isValidPlace(placeName)) {
      socket.emit('error', 'Invalid place name');
      return;
    }

    if (room.letterInPlay && placeName.charAt(0).toLowerCase() !== room.letterInPlay.toLowerCase()) {
      socket.emit('error', `Place name must start with '${room.letterInPlay}'`);
      return;
    }

    if (room.history.some(entry => entry.place.toLowerCase() === placeName.toLowerCase())) {
      socket.emit('error', 'This place has already been used');
      return;
    }

    const lastLetter = placeName.charAt(placeName.length - 1).toUpperCase();
    room.letterInPlay = lastLetter;
    room.history.push({
      player: currentPlayer.username,
      place: placeName,
      timestamp: Date.now(),
    });

    currentPlayer.score += 1;

    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

    io.to(roomId).emit('updateGame', room);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && gameRooms[roomId]) {
      const room = gameRooms[roomId];

      const playerIndex = room.players.findIndex(player => player.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);

        if (playerIndex <= room.currentPlayerIndex && room.currentPlayerIndex > 0) {
          room.currentPlayerIndex--;
        }

        if (room.players.length === 0) {
          delete gameRooms[roomId];
        } else {
          io.to(roomId).emit('playerLeft', {
            username: socket.id,
            room: room,
          });
        }
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/socket.io/`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});