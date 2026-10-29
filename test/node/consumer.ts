import {
    type AbortSignal,
    Api,
    type ApiCallFn,
    type ApiClientOptions,
    Bot,
    type Context,
    type RawApi,
    type Transformer,
} from "../../out/mod.js";

export function consumeSignal(
    signal: AbortSignal,
    context: Context,
    call: ApiCallFn,
    transform: Transformer,
) {
    const bot = new Bot("local-test-token");
    const api = new Api("local-test-token");
    const raw: RawApi = api.raw;
    const payload: Parameters<RawApi["sendMessage"]>[0] = {
        chat_id: 1,
        text: "signal compatibility",
    };
    const chatId: number | string = payload.chat_id;
    const text: string = payload.text;
    const transformer: Transformer = (prev, method, args, incoming) =>
        prev(method, args, incoming ?? signal);
    api.config.use(transformer);
    return [
        bot.init(signal),
        api.getMe(signal),
        api.sendMessage(chatId, text, {}, signal),
        raw.getMe(signal),
        raw.sendMessage(payload, signal),
        context.getChat(signal),
        context.reply(text, {}, signal),
        call("getMe", {}, signal),
        call("sendMessage", payload, signal),
        transform(call, "sendMessage", payload, signal),
    ];
}

type FetchOptions = NonNullable<
    Parameters<NonNullable<ApiClientOptions["fetch"]>>[1]
>;

type Equal<T, U> = (<V>() => V extends T ? 1 : 2) extends
    (<V>() => V extends U ? 1 : 2) ? true : false;

export const fetchSignalIsStructural: Equal<
    NonNullable<FetchOptions["signal"]>,
    AbortSignal
> = true;

export function consumeFetchSignal(
    signal: AbortSignal,
): FetchOptions["signal"] {
    return signal;
}

export type BaseConfigHasNoSignal = "signal" extends
    keyof NonNullable<ApiClientOptions["baseFetchConfig"]> ? never : true;
export const baseConfigHasNoSignal: BaseConfigHasNoSignal = true;
