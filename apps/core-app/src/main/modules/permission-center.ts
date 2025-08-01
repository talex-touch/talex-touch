import fse from "fs-extra";
import path from "path";
import type { Permission, IPermissionCenter } from "@talex-touch/utils/permission";

class PermissionCenter implements IPermissionCenter {
  addPermission(pluginScope: string, permission: Permission): void {
    const index = this.getPerIndex(pluginScope, permission)

    if (index !== -1) throw new Error("Permission already exists")
    if (!this.perMap.has(pluginScope)) {
      this.perMap.set(pluginScope, [])
    }

    const perArr = this.perMap.get(pluginScope)!

    perArr.push(permission)
  }

  delPermission(pluginScope: string, permission: Permission): void {
    const index = this.getPerIndex(pluginScope, permission)

    if (index === -1) throw new Error("Permission not exists")

    const perArr = this.getPerFile(pluginScope)

    perArr.splice(index, 1)

    this.perMap.set(pluginScope, perArr)
  }

  hasPermission(pluginScope: string, permission: Permission): boolean {
    return this.getPerFile(pluginScope).some(per => per.id === permission.id)
  }

  getPermission(pluginScope: string, permission: symbol): Permission {
    return this.getPerFile(pluginScope).find(per => per.id === permission)!
  }

  rootPath: string

  perMap: Map<string, Array<Permission>> = new Map()

  constructor(rootPath: string) {
    this.rootPath = rootPath
  }

  getPerIndex(pluginScope: string, permission: Permission) {
    return this.getPerFile(pluginScope).findIndex(per => per.id === permission.id)
  }

  getPerFile(pluginScope: string): Array<Permission> {
    if (!this.perMap.has(pluginScope))
      this.perMap.set(pluginScope, JSON.parse(fse.readJSONSync(this.getPerPath(pluginScope))))
    return this.perMap.get(pluginScope)!
  }

  getPerPath(pluginScope: string) {
    return path.join(this.rootPath, pluginScope + ".json")
  }

  async save() {
    const promises = new Array<Function>()
    this.perMap.forEach((perArr, pluginScope) => promises.push(() => {
      if (!fse.existsSync(this.rootPath)) {
        fse.mkdirSync(this.rootPath, { recursive: true })
      }
      fse.writeJSONSync(this.getPerPath(pluginScope), JSON.stringify(perArr))
    }))

    await Promise.all(promises)
  }
}

let permissionCenter: PermissionCenter

export function genPermissionCenter(rootPath?: string): IPermissionCenter {
  if (!permissionCenter) {
    permissionCenter = new PermissionCenter(rootPath!)
  }

  return permissionCenter
}

export default {
  name: Symbol("PermissionCenter"),
  filePath: "permissions",
  init() {
    const that: any = this
    const perPath = that['modulePath']!

    genPermissionCenter(perPath)
  },
  destroy() {
    permissionCenter.save()
  },
};
