const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const routes = require('./routes');
const webSocketController = require('./controllers');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use('/', routes);

wss.on('connection', (ws) => {
  webSocketController.handleConnection(ws);
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
