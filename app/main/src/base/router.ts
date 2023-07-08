/*
 * Copyright (c) 2022. TalexDreamSoul
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except adopters compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to adopters writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createRouter, createWebHashHistory } from "vue-router";
import Home from '../views/base/home/HomePage.vue'

const routes: any = [
  {
    path: "/",
    redirect: "/home",
  },
  {
    path: "/home",
    name: "HomePage",
    component: Home,
    meta: {
      index: 1,
    },
  },
  {
    path: "/market",
    name: "Plugin Market",
    component: () => import("../views/base/Market.vue"),
    meta: {
      index: 2,
    },
  },
  {
    path: "/plugin",
    name: "Plugin",
    component: () => import("../views/base/Plugin.vue"),
    meta: {
      index: 3,
    },
  },
  {
    path: "/styles",
    name: "Styles",
    component: () => import("../views/base/styles/ThemeStyle.vue"),
    meta: {
      index: 4,
    }
  },
  {
    path: "/styles/theme",
    name: "Theme",
    component: () => import("../views/base/styles/sub/ThemePreference.vue"),
    meta: {
      index: 4
    }
  },
  {
    path: "/setting",
    name: "AppSettings",
    component: () => import("../views/base/settings/AppSettings.vue"),
    meta: {
      index: 5,
    },
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// router.beforeEach(async (to, from, next) => {
//
//     // if( to.name )
//     //     document.title = `${GlobalConfig.name} | ${String(to.name)}`
//     //
//     // if( !to?.meta?.loginRequired ) return next()
//     //
//     // const store = useStore()
//     //
//     // if( !store.local.loggedIn ) {
//     //
//     //     window.$tipper.tip('请先登录!', {
//     //         stay: 4200,
//     //         type: TipType.WARNING
//     //     })
//     //
//     //     return router.back()
//     //
//     // }
//     //
//     // if( to.meta?.adminRequired ) {
//     //
//     //     // @ts-ignore
//     //     if( !store.local.admin  ) {
//     //
//     //         window.$tipper.tip('您没有全新!', {
//     //             stay: 4200,
//     //             type: TipType.WARNING
//     //         })
//     //
//     //         return router.back()
//     //
//     //     }
//     //
//     // }
//
//     return next()
//
// })

export default router;
