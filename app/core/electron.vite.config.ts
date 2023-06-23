import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import vueJsx from "@vitejs/plugin-vue-jsx";

// import topLevelAwait from "vite-plugin-top-level-await";
import commonjsExternal from "vite-plugin-commonjs-externals";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import Unocss from "unocss/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import VueSetupExtend from "vite-plugin-vue-setup-extend";

export default defineConfig({
  main: {
    publicDir: "../../public",
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: path.join(__dirname, "main", "index.ts"),
        },
      },
    },
    resolve: {
      alias: [
        {
          find: "@addon",
          replacement: path.join(__dirname, "main", "addon"),
        },
        {
          find: "@config",
          replacement: path.join(__dirname, "main", "config"),
        },
        {
          find: "@utils",
          replacement: path.join(__dirname, "main", "utils"),
        },
        {
          find: "~",
          replacement: __dirname,
        },
      ],
    },
    plugins: [
      commonjsExternal({
        externals: [
          'path'
        ]
      }),
      externalizeDepsPlugin({
        exclude: [
          'chokidar',
          'mica-electron',
          'compressing',
          'fs-extra',
          'fs', 'path',
          'graceful-fs',
          'jsonfile'
        ],
      }),
    ],
  },
  renderer: () => {
    const basePath = path.join(__dirname, "renderer");

    return {
      root: basePath,
      build: {
        outDir: "dist/renderer",
        rollupOptions: {
          input: {
            index: path.join(basePath, "index.html"),
          },
        },
      },
      resolve: {
        alias: {
          "@modules": path.join(basePath, "modules"),
          "@comp": path.join(basePath, "components"),
          "@styles": path.join(basePath, "styles"),
          "@assets": path.join(basePath, "assets"),
          "~": basePath,
        },
      },
      plugins: [
        vue({
          customElement: ["webview"],
        }),
        Unocss(),
        vueJsx(),
        AutoImport({
          resolvers: [ElementPlusResolver()],
          imports: ["vue"],
        }),
        Components({
          resolvers: [ElementPlusResolver()],
        }),
        VueI18nPlugin({
          include: path.join(__dirname, "assets/languages/**"),
        }),
        VueSetupExtend(),
      ],
      optimizeDeps: {
        exclude: [],
      },
    };
  },
});
