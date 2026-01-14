import { Context, Schema, Fragment, Element, h } from "koishi";
// noinspection ES6UnusedImports
import {} from "koishi-plugin-to-image-service";

export const name = "text-to-image";

export const inject = ["toImageService"];

export interface Config {
  background: string;
}

export const Config: Schema<Config> = Schema.object({
  background: Schema.string().default("#efefef").description("background"),
});

function buildLazyProxyHandler(
  getObj: () => any,
  hooks?: {
    get: (obj: any, prop: PropertyKey) => any;
  },
) {
  const handlerMap = {};
  let needInit = true;
  Reflect.ownKeys(Reflect).forEach((key) => {
    handlerMap[key] = (target: any, ...args: any[]) => {
      const obj = getObj();
      if (needInit) {
        needInit = false;
        Reflect.ownKeys(obj).forEach((k) => (target[k] = obj[k]));
        Reflect.setPrototypeOf(target, Reflect.getPrototypeOf(obj));
      }
      if (key === "set") {
        Reflect[key].apply(Reflect, [target, args[0], args[1]]);
      } else if (key === "deleteProperty") {
        Reflect[key].apply(Reflect, [target, args]);
      }
      let res: any;
      if (key === "get") {
        res = hooks?.get
          ? hooks.get(obj, args[0])
          : Reflect[key].apply(Reflect, [obj, args[0]]);
        if (typeof res === "function") {
          res = res.bind(args[1]);
        }
      } else {
        res = Reflect[key].apply(Reflect, [obj, ...args]);
      }
      return res;
    };
  });
  return handlerMap;
}

function isNull(obj: any): obj is null | undefined | void {
  return obj === null || typeof obj === "undefined";
}

async function traverseElements(
  elements: Element[],
  handle: (element: Element) => Promise<Element | void>,
) {
  if (isNull(elements)) return;
  for (let i = 0; i < elements.length; i++) {
    let element = elements[i];
    const newEle = await handle(element);
    if (!isNull(newEle)) {
      element = newEle;
      elements[i] = newEle;
    }
    if (Array.isArray(element.children)) {
      await traverseElements(element.children, handle);
    }
  }
}

export function apply(ctx: Context, config: Config) {
  const baseStyle = `white-space: pre-wrap;background:${config.background};`;
  ctx
    .command("cmdToImg <cmd:text>")
    .alias("c2i")
    .action(async (argv, cmd) => {
      async function sendFn(fragment: Fragment) {
        const elements = h.normalize(fragment);
        await traverseElements(elements, async (element) => {
          if (element.type === "text" && !isNull(element.attrs?.content)) {
            const reactElement =
              ctx.toImageService.toReactElement.htmlToReactElement(
                `<div style="${baseStyle}">${element.attrs.content}</div>`,
              );
            const svg =
              await ctx.toImageService.reactElementToSvg.satori(reactElement);
            const img = await ctx.toImageService.svgToImage.skiaCanvasCanvg(
              svg,
              "png",
            );
            return h.image(img, "image/png");
          }
        });
        return argv.session.send(elements);
      }
      const handlerMap = buildLazyProxyHandler(() => argv.session, {
        get(obj: any, prop: PropertyKey) {
          if (prop === "send") {
            return sendFn;
          }
          return obj[prop];
        },
      });
      const proxyRevocable = Proxy.revocable(
        {} as typeof argv.session,
        handlerMap,
      );
      await proxyRevocable.proxy.execute.bind(proxyRevocable.proxy)(cmd);
    });
}
