import type {
    Body as FetchBody,
    BodyInit as FetchBodyInit,
    Headers as FetchHeaders,
    Request as FetchRequest,
    Response as FetchResponse,
} from "node-fetch";

declare global {
    type Body = FetchBody;
    type BodyInit = FetchBodyInit;
    type Headers = FetchHeaders;
    type Request = FetchRequest;
    type Response = FetchResponse;
}
