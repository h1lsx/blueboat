import EventEmitterPubSub from './lib/pubsub/EventEmitter'
import PubSub from './lib/pubsub/PubSub'
import RabbitMQPubSub from './lib/pubsub/RabbitMQ'
import RedisPubSub from './lib/pubsub/Redis'
import Client from './lib/room/Client'
import Room from './lib/room/Room'
import Server from './lib/server/Server'
import SimpleClient from './types/SimpleClient'

export interface EntityMap<T> {
  [entityId: string]: T
}

export { nonenumerable as nosync } from 'nonenumerable'

export {
  Server,
  Room,
  Client,
  SimpleClient,
  PubSub,
  RedisPubSub,
  EventEmitterPubSub,
  RabbitMQPubSub
}
