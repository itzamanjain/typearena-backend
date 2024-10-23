import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  }
});

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
  console.log('All Systems are running ✅');
  res.send('Typing Test API');
});

let rooms = {};

const fetchTextFromDB = () => {
  return "This is a simple typing competition test text. Good luck!";
};

const calculateWPM = (typedLength, timeElapsedInSeconds) => {
  const wordsTyped = typedLength / 5;
  return ((wordsTyped / timeElapsedInSeconds) * 60).toFixed(2);
};

const calculateAccuracy = (correctChars, totalChars) => {
  if (totalChars === 0) return 100;
  return ((correctChars / totalChars) * 100).toFixed(2);
};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('createRoom', ({ roomId }) => {
    rooms[roomId] = {
      admin: socket.id,
      players: {},
      text: fetchTextFromDB(),
      startTime: null,
      isStarted: false,
      countdown: 3,
    };
    socket.join(roomId);
    console.log(`Room created: ${roomId} by ${socket.id}`);
    socket.emit('roomCreated', { roomId, isAdmin: true });
  });

  socket.on('joinRoom', ({ roomId }) => {
    if (rooms[roomId]) {
      rooms[roomId].players[socket.id] = { progress: 0, wpm: 0, accuracy: 100, typedText: '', correctChars: 0 };
      socket.join(roomId);
      socket.emit('roomJoined', { 
        text: rooms[roomId].text, 
        isStarted: rooms[roomId].isStarted,
        isAdmin: rooms[roomId].admin === socket.id,
        countdown: rooms[roomId].countdown
      });
      io.to(roomId).emit('playerJoined', { players: rooms[roomId].players });
    } else {
      socket.emit('roomError', 'Room does not exist');
    }
  });

  socket.on('startTest', ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId].admin === socket.id) {
      rooms[roomId].isStarted = true;
      startCountdown(roomId);
    }
  });

  const startCountdown = (roomId) => {
    const countdownInterval = setInterval(() => {
      if (rooms[roomId].countdown > 0) {
        io.to(roomId).emit('countdown', { count: rooms[roomId].countdown });
        rooms[roomId].countdown--;
      } else {
        clearInterval(countdownInterval);
        rooms[roomId].startTime = Date.now();
        io.to(roomId).emit('startTyping');
        startRoomTimer(roomId);
      }
    }, 1000);
  };

  socket.on('updateProgress', ({ roomId, typedText }) => {
    if (rooms[roomId] && rooms[roomId].players[socket.id] && rooms[roomId].isStarted) {
      const roomText = rooms[roomId].text;
      let correctChars = 0;

      for (let i = 0; i < typedText.length; i++) {
        if (typedText[i] === roomText[i]) correctChars++;
      }

      const timeElapsed = (Date.now() - rooms[roomId].startTime) / 1000;
      const wpm = calculateWPM(typedText.length, timeElapsed);
      const accuracy = calculateAccuracy(correctChars, typedText.length);

      rooms[roomId].players[socket.id] = { 
        typedText, 
        correctChars, 
        progress: (typedText.length / roomText.length) * 100, 
        wpm, 
        accuracy 
      };

      io.to(roomId).emit('updateLeaderboard', { players: rooms[roomId].players });
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit('updateLeaderboard', { players: rooms[roomId].players });
      }
      if (rooms[roomId].admin === socket.id) {
        io.to(roomId).emit('adminLeft');
        delete rooms[roomId];
      }
    }
    console.log('User disconnected:', socket.id);
  });

  const startRoomTimer = (roomId) => {
    setTimeout(() => {
      if (rooms[roomId]) {
        const room = rooms[roomId];
        const timeElapsed = (Date.now() - room.startTime) / 1000;

        Object.keys(room.players).forEach(playerId => {
          const player = room.players[playerId];
          const finalWpm = calculateWPM(player.typedText.length, timeElapsed);
          player.wpm = finalWpm;
        });

        io.to(roomId).emit('finalResults', { players: room.players });
        delete rooms[roomId];
      }
    }, 60000);
  };
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
