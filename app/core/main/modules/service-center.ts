import { touchChannel } from '@modules/channel/channel-core';
import fse from "fs-extra";
import path from "path";
import { TalexTouch } from "../types";
import type { IService, IServiceCenter, IServiceEvent, IServiceHandler } from "@talex-touch/utils/service";
import { ChannelType } from '@talex-touch/utils/channel';

class ServiceCenter implements IServiceCenter {

  rootPath: string

  perMap: Map<IService, IServiceHandler> = new Map()

  constructor(rootPath: string) {
    this.rootPath = rootPath
  }

  regService(service: IService, handler: IServiceHandler): boolean {
    if (this.hasService(service)) return false;

    this.perMap.set(service, handler)
  }
  unRegService(service: IService): boolean {
    if (!this.hasService(service)) return false;

    this.perMap.delete(service)
  }
  getService(id: symbol): IService {
    return [...this.perMap.keys()].find(service => service.id === id)
  }
  useService(service: IService, data: object): boolean | Promise<boolean> {
    const handler = this.perMap.get(service)

    if (!handler) return false;

    let cancelled = false

    const event: IServiceEvent = {
      service,
      setCancelled(_cancelled: boolean) {
        cancelled = _cancelled
      },
      isCancelled() {
        return cancelled
      }
    }

    return handler.handle(event, data)
  }

  hasService(service: IService): boolean {
    return this.perMap.has(service)
  }

  getPerPath(serviceID: symbol) {
    return path.join(this.rootPath, serviceID.description + ".json")
  }

  async save() {
    const promises = []
    this.perMap.forEach((handler, service) => promises.push(() => {

      fse.writeJSONSync(this.getPerPath(service.id), JSON.stringify({
        pluginScope: handler.pluginScope,
        service: service
      }))
    }))

    await Promise.all(promises)
  }
}

let serviceCenter: ServiceCenter

export function genServiceCenter(rootPath?: string): IServiceCenter {
  if (!serviceCenter) {
    serviceCenter = new ServiceCenter(rootPath)
  }

  return serviceCenter
}

export default {
  name: Symbol("ServiceCenter"),
  filePath: "services",
  listeners: new Array<Function>,
  init() {
    const perPath = this.modulePath

    genServiceCenter(perPath)

    this.listeners.push(
      this.touchChannel.regChannel(ChannelType.PLUGIN, 'service:reg', ({ data, reply, plugin }) => {
        const { service } = data

        if (serviceCenter.hasService(service)) return reply(false)

        serviceCenter.regService(service, {
          pluginScope: plugin,
          handle(event, data) {
            this.touchChannel.send(ChannelType.PLUGIN, 'service:handle', { event, data })
          }
        })

        reply(true)
      })
    )

    this.listeners.push(
      this.touchChannel.regChannel(ChannelType.PLUGIN, 'service:unreg', ({ data, reply }) => {
        const { service } = data

        if (!serviceCenter.hasService(service)) return reply(false)

        serviceCenter.unRegService(service)
      }
    )
  },
  destroy() {
    this.listeners.forEach(listener => listener())

    serviceCenter.save()
  },
} as TalexTouch.IModule;
