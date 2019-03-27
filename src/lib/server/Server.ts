import bodyParser from 'body-parser'
import Express from 'express'
import basicAuth from 'express-basic-auth'
import { Server as HTTPServer } from 'http'
import { RedisOptions } from 'ioredis'
import socket from 'socket.io'
import MessagePackParser from 'socket.io-msgpack-parser'
import redisAdapter from 'socket.io-redis'
import AvaiableRoomType from '../../types/AvailableRoomType'
import GetGameValues from '../api/GetGameValues'
import GetRoom from '../api/GetRoom'
import GetRooms from '../api/GetRooms'
import SetGameValues from '../api/SetGameValues'
import { PLAYER_LEFT } from '../constants/PubSubListeners'
import BUNDLED_PANEL_JS from '../panel/bundle'
import PubSub from '../pubsub/PubSub'
import Room from '../room/Room'
import ConnectionHandler from './Connection/ConnectionHandler'
import CustomGameValues from './CustomGameValues'
import Emitter from './Emitter'
import RedisClient from './RedisClient'
import RoomFetcher from './RoomFetcher'

const PANEL_PREFIX = '/blueboat-panel'
const PANEL_HTML = `
<html>
<head>
<title>Blueboat Panel</title>
</head>
<div id='root'></div>
<script>
${BUNDLED_PANEL_JS.js}
</script>
</html>
`

interface ServerArguments {
  app: Express.Application
  redisOptions: RedisOptions
  useRedisSocketAdapter?: boolean
  pubsub: PubSub
  admins: any
  customRoomIdGenerator?: (roomName: string, options?: any) => string
}

interface ServerState {
  availableRoomTypes: AvaiableRoomType[]
  managingRooms: Map<string, Room>
}

const signals = ['SIGINT', 'SIGTERM', 'SIGUSR2', 'uncaughtException']

class Server {
  public server: HTTPServer = null
  public redis: RedisClient = null
  public gameValues: CustomGameValues

  public state: ServerState = {
    availableRoomTypes: [],
    managingRooms: new Map()
  }
  public listen: (port: number, callback?: () => void) => void = null
  private app: Express.Application = null
  private io: SocketIO.Server = null
  private pubsub: PubSub
  private roomFetcher: RoomFetcher = null
  private customRoomIdGenerator = null

  constructor(options: ServerArguments) {
    this.app = options.app
    this.redis = new RedisClient({
      clientOptions: options.redisOptions as any
    })
    // @ts-ignore
    this.pubsub = options.pubsub
    this.roomFetcher = new RoomFetcher({ redis: this.redis })
    this.gameValues = new CustomGameValues({ redis: this.redis })
    this.customRoomIdGenerator = options.customRoomIdGenerator
    this.spawnServer(
      options.redisOptions,
      options.useRedisSocketAdapter,
      options.admins || {}
    )
  }

  public registerRoom = (roomName: string, handler: any, options?: any) => {
    const { availableRoomTypes } = this.state
    if (availableRoomTypes.map(room => room.name).includes(roomName)) {
      // Can't have two handlers for the same room
      return
    }
    this.state.availableRoomTypes.push({ name: roomName, handler, options })
    return
  }

  public gracefullyShutdown = () =>
    this.shutdown()
      .then()
      .catch()

  private onRoomMade = (room: Room) => {
    this.state.managingRooms.set(room.roomId, room)
  }
  private onRoomDisposed = (roomId: string) => {
    this.state.managingRooms.delete(roomId)
  }

  private spawnServer = (
    redisOptions: RedisOptions,
    useRedisSocketAdapter: boolean,
    adminUsers: any
  ) => {
    this.server = new HTTPServer(this.app)
    this.makeRoutes(adminUsers)
    this.listen = (port: number, callback?: () => void) => {
      this.server.listen(port, callback)
    }
    this.io = socket({
      parser: MessagePackParser,
      path: '/blueboat',
      transports: ['websocket']
    })
    if (useRedisSocketAdapter) {
      this.io.adapter(redisAdapter(redisOptions))
    }
    this.io.attach(this.server)
    this.io.on('connection', s =>
      ConnectionHandler({
        availableRoomTypes: this.state.availableRoomTypes,
        io: this.io,
        pubsub: this.pubsub,
        redis: this.redis,
        roomFetcher: this.roomFetcher,
        gameValues: this.gameValues,
        socket: s,
        onRoomMade: this.onRoomMade,
        onRoomDisposed: this.onRoomDisposed,
        customRoomIdGenerator: this.customRoomIdGenerator
      })
    )

    this.spawnPubSub()

    signals.forEach(signal =>
      process.once(signal as any, (reason?: any) =>
        this.shutdown(signal, reason)
      )
    )
  }

  private spawnPubSub = () => {
    this.pubsub.on(PLAYER_LEFT, (playerId: string) => {
      Emitter.emit(PLAYER_LEFT, playerId)
    })
  }

  private makeRoutes = (adminUsers: any) => {
    const router = Express.Router()
    router.use(bodyParser.json())
    // @ts-ignore
    router.use((req, res, next) => {
      // @ts-ignore
      req.gameServer = this
      next()
    })
    router.use(basicAuth({ users: adminUsers, challenge: true }))
    // @ts-ignore
    router.get('/', (req, res) => {
      res.send(PANEL_HTML)
    })
    router.get('/rooms', GetRooms)
    router.get('/rooms/:room', GetRoom)
    router.get('/gameValues', GetGameValues)
    router.post('/gameValues', SetGameValues)
    this.app.use(PANEL_PREFIX, router)
  }

  private shutdown = async (signal?: string, reason?: any) => {
    console.log('shutting down')
    if (signal === 'uncaughtException' && reason) {
      console.log(reason)
    }
    try {
      if (!this.state.managingRooms.size) {
        return
      }
      await Promise.all(
        Array.from(this.state.managingRooms.values()).map(room =>
          room
            .dispose()
            .then()
            .catch()
        )
      )
      this.io.close()
      this.server.close()
    } catch (e) {
      this.io.close()
      this.server.close()
      return
    }
  }
}

export default Server
