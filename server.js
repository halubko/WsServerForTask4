import express from 'express'
import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import cors from 'cors'

const PORT = process.env.PORT || 3000
const ADMIN = "Admin"

const app = express()

app.use(cors())
app.use(express.json())

app.get('/api/messages/:userId', (req, res) => {
  res.status(200).json([
    {
      id: crypto.randomUUID(),
      senderId: 2,
      senderName: "Michael Williams",
      content: "Hello",
      createdAt: "2025-11-04T00:00:00.000Z",
    },
    {
      id: crypto.randomUUID(),
      senderId: 2,
      senderName: "Michael Williams",
      content: "How you doing?",
      createdAt: "2025-11-04T00:01:00.000Z",
    },
    {
      id: crypto.randomUUID(),
      senderId: 1,
      senderName: "Emily Johnson",
      content: "Hi! I'm good. What about you?",
      createdAt: "2025-11-04T01:00:00.000Z",
    },
  ])
})

const expressServer = app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`)
})

const UsersState = {
  users: [],
  setUsers: function (newUsersArray) {
    this.users = newUsersArray
  }
}

const wss = new WebSocketServer({ server: expressServer })

const sendJson = (ws, message) => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

const broadcastToRoom = (room, message, excludeId = null) => {
  wss.clients.forEach(client => {
    const user = getUser(client.id)
    if (client.readyState === client.OPEN && user && user.room === room) {
      if (excludeId && client.id === excludeId) return
      sendJson(client, message)
    }
  })
}

const broadcastGlobal = (type, data) => {
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      sendJson(client, type, data)
    }
  })
}

wss.on('connection', (ws) => {
  ws.on('message', (messageRaw) => {
    let messageData
    try {
      messageData = JSON.parse(messageRaw)
    } catch (e) {
      console.error("Invalid JSON")
      return
    }

    const { type, data } = messageData

    switch (type) {
      case 'enterRoom': {
        const { name, room } = data
        const prevRoom = getUser(ws.id)?.room

        if (prevRoom) {
          broadcastToRoom(prevRoom, 'message', buildMsg(ADMIN, `${name} has left the room`))
        }

        const user = activateUser(ws.id, name, room)

        if (prevRoom) {
          broadcastToRoom(prevRoom, 'userList', {
            users: getUsersInRoom(prevRoom)
          })
        }

        sendJson(ws, 'message', buildMsg(ADMIN, `You have joined the ${user.room} chat room`))
        broadcastToRoom(user.room, 'message', buildMsg(ADMIN, `${user.name} has joined the room`), ws.id)

        broadcastToRoom(user.room, 'userList', {
          users: getUsersInRoom(user.room)
        })

        broadcastGlobal('roomList', {
          rooms: getAllActiveRooms()
        })
        break
      }

      case 'message:send': {
        const { content } = messageData
        const sender = getUser(ws.id)

        if (sender && sender.room) {
          const messagePayload = {
            type: 'message:receive',
            id: crypto.randomUUID(),
            senderId: sender.id,
            senderName: sender.name,
            content: content,
            createdAt: new Date().toISOString()
          }

          broadcastToRoom(sender.room, messagePayload)
        }
        break
      }

      case 'activity': {
        const name = data
        const room = getUser(ws.id)?.room
        if (room) {
          broadcastToRoom(room, 'activity', name, ws.id)
        }
        break
      }

      case "connection": {
        try {
          const userDecoded = jwt.decode(data.token)
          if (!userDecoded) return;

          ws.id = userDecoded.id
          console.log(`User ${ws.id} connected`)

          sendJson(ws, 'system', buildMsg(userDecoded.username, "Welcome to Chat App!"))

          activateUser(ws.id, userDecoded.firstName + " " + userDecoded.lastName, 1)
        } catch (e) {
          console.error("Auth error", e)
        }
        break
      }
    }
  })

  ws.on('close', () => {
    const user = getUser(ws.id)
    userLeavesApp(ws.id)

    if (user && user.room) {
      broadcastToRoom(user.room, 'message', buildMsg(ADMIN, `${user.name} has left the room`))
      broadcastToRoom(user.room, 'userList', {
        users: getUsersInRoom(user.room)
      })
      broadcastGlobal('roomList', {
        rooms: getAllActiveRooms()
      })
    }
    console.log(`User ${ws.id || 'unknown'} disconnected`)
  })
})

function buildMsg(name, text) {
  return {
    name,
    text,
    time: new Intl.DateTimeFormat('default', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    }).format(new Date())
  }
}

function activateUser(id, name, room) {
  const user = { id, name, room }
  UsersState.setUsers([
    ...UsersState.users.filter(user => user.id !== id),
    user
  ])
  return user
}

function userLeavesApp(id) {
  UsersState.setUsers(
    UsersState.users.filter(user => user.id !== id)
  )
}

function getUser(id) {
  return UsersState.users.find(user => user.id === id)
}

function getUsersInRoom(room) {
  return UsersState.users.filter(user => user.room === room)
}

function getAllActiveRooms() {
  return Array.from(new Set(UsersState.users.map(user => user.room).filter(r => r)))
}