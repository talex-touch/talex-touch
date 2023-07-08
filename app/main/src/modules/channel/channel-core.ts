const { ipcRenderer, IpcMainEvent } = require("electron");
import {
  ChannelType,
  DataCode,
  ITouchClientChannel,
  RawChannelSyncData,
  RawStandardChannelData,
  StandardChannelData,
} from "@talex-touch/utils/channel";

class TouchChannel implements ITouchClientChannel {
  channelMap: Map<string, Function[]> = new Map();

  pendingMap: Map<string, Function> = new Map();

  constructor() {
    ipcRenderer.on("@main-process-message", this.__handle_main.bind(this));
  }

  __parse_raw_data(e, arg): RawStandardChannelData {
    // console.log("Raw data: ", arg, e);
    if (arg) {
      const { name, header, code, plugin, data, sync } = arg;

      if (header) {
        return {
          header: {
            status: header.status || "request",
            type: ChannelType.MAIN,
            _originData: arg,
          },
          sync,
          code,
          data,
          plugin,
          name: name as string,
        };
      }
    }

    console.error(e, arg);
    return null;
    // throw new Error("Invalid message!");
  }

  __handle_main(e: typeof IpcMainEvent, arg: any): any {
    const rawData = this.__parse_raw_data(e, arg);
    if ( !rawData ) return

    if ( rawData.header.status === 'reply' && rawData.sync ) {
      const { id } = rawData.sync;

      return this.pendingMap.get(id)?.(rawData);
    }

    this.channelMap.get(rawData.name)?.forEach((func) => {
      const handInData: StandardChannelData = {
        reply: (code: DataCode, data: any, options: any) => {
          e.sender.send(
            "@main-process-message",
            this.__parse_sender(code, rawData, data, rawData.sync)
          );
        },
        ...rawData,
      };

      const res = func(handInData);

      if (res && res instanceof Promise) return;

      handInData.reply(DataCode.SUCCESS, res);
    });
  }

  __parse_sender(
    code: DataCode,
    rawData: RawStandardChannelData,
    data: any,
    sync?: RawChannelSyncData
  ): RawStandardChannelData {
    return {
      code,
      data,
      sync: !sync
        ? undefined
        : {
            timeStamp: new Date().getTime(),
            // reply sync timeout should follow the request timeout, unless user set it.
            timeout: sync.timeout,
            id: sync.id,
          },
      name: rawData.name,
      header: {
        status: "reply",
        type: rawData.header.type,
        _originData: rawData.header._originData,
      },
    };
  }

  regChannel(
    eventName: string,
    callback: Function
  ): () => void {
    const listeners = this.channelMap.get(eventName) || [];

    if (!listeners.includes(callback)) {
      listeners.push(callback);
    } else return undefined;

    this.channelMap.set(eventName, listeners);

    return () => {
      const index = listeners.indexOf(callback);

      if (index !== -1) {
        listeners.splice(index, 1);
      }
    };
  }

  send(eventName: string, arg: any): Promise<any> {
    const uniqueId = `${new Date().getTime()}#${eventName}@${Math.random().toString(
      12
    )}`;

    const data = {
      code: DataCode.SUCCESS,
      data: arg,
      sync: {
        timeStamp: new Date().getTime(),
        timeout: 10000,
        id: uniqueId,
      },
      name: eventName,
      header: {
        status: "request",
        type: ChannelType.MAIN,
      },
    } as RawStandardChannelData;

    return new Promise((resolve) => {
      
      ipcRenderer.send("@main-process-message", data);

      this.pendingMap.set(uniqueId, (res) => {
        this.pendingMap.delete(uniqueId);

        resolve(res.data);
      });
    });
  }

  sendSync(eventName: string, arg?: any): any {
    const data = {
      code: DataCode.SUCCESS,
      data: arg,
      name: eventName,
      header: {
        status: "request",
        type: ChannelType.MAIN,
      },
    } as RawStandardChannelData;

    const res = this.__parse_raw_data(null, ipcRenderer.sendSync("@main-process-message", data))
    
    if ( res.header.status === 'reply' ) return res.data;

    return res;

  }
}

export const touchChannel: ITouchClientChannel = window['$channel'] = new TouchChannel();
