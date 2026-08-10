/**
 * Generated-client wire-shape tests for OpenAPI `style: deepObject`, `explode: true` (#226).
 *
 * WHY THIS ASSERTS A URL AND NOT SOURCE TEXT. The defect this guards against is a *runtime*
 * serialization defect: the generated source can look plausible while the request that leaves the
 * client carries the wrong query string. Every assertion below therefore drives the real generated
 * client through a stub axios instance and reads the URL the client actually produced, all the way
 * through `setSearchParams`/`setFlattenedQueryParams` and `createRequestFunction`.
 *
 * WHAT WENT WRONG. The corrected contract declares `explode: true` on the eight `streamOptions`
 * parameters, naming `?streamOptions[key]=value`. openapi-generator's stock `typescript-axios`
 * template expands an exploded object WITHOUT the parameter name, emitting `?key=value`. The
 * server's model binder happens to accept that too, but acceptance by one binder is not permission
 * for an official generated client to ignore the canonical contract — the next consumer of this
 * SDK is not obliged to be this server.
 *
 * The correction lives in `scripts/openapi-templates/typescript-axios/apiInner.mustache` and is
 * structural: it fires on the generator's own exploded-non-primitive-non-array branch, which is
 * precisely deepObject/explode semantics. It names no route, parameter or operation, so a future
 * deepObject parameter is serialized correctly without touching this file.
 */

import { describe, expect, it } from 'vitest';

import { ArtistApi } from './generated/api/artist-api';
import { AudioApi } from './generated/api/audio-api';
import { VideoApi } from './generated/api/video-api';
import { Configuration } from './generated/configuration';

const BASE = 'http://tesserafin.test';

/** Captures the request config the generated client hands to axios, without any network. */
function captureUrl() {
    const calls: string[] = [];
    const stubAxios = {
        defaults: {},
        request(config: { url?: string }) {
            calls.push(String(config.url ?? ''));
            return Promise.resolve({
                data: null,
                status: 200,
                headers: {},
                config
            });
        }
    };
    return {
        axios: stubAxios as never,
        lastUrl: () => {
            if (calls.length !== 1) {
                throw new Error(
                    `expected exactly one request, saw ${calls.length}`
                );
            }
            return new URL(calls[0]);
        }
    };
}

const configuration = new Configuration({ basePath: BASE });

/** The eight contract sites carrying `streamOptions` as deepObject/explode: true. */
const DEEP_OBJECT_SITES: Array<{
    name: string;
    call: (api: never, request: Record<string, unknown>) => Promise<unknown>;
    api: 'audio' | 'video';
    extra?: Record<string, unknown>;
}> = [
    {
        name: 'GetAudioStream',
        api: 'audio',
        call: (a: never, r) =>
            (a as unknown as AudioApi).getAudioStream(r as never)
    },
    {
        name: 'HeadAudioStream',
        api: 'audio',
        call: (a: never, r) =>
            (a as unknown as AudioApi).headAudioStream(r as never)
    },
    {
        name: 'GetAudioStreamByContainer',
        api: 'audio',
        extra: { container: 'mp3' },
        call: (a: never, r) =>
            (a as unknown as AudioApi).getAudioStreamByContainer(r as never)
    },
    {
        name: 'HeadAudioStreamByContainer',
        api: 'audio',
        extra: { container: 'mp3' },
        call: (a: never, r) =>
            (a as unknown as AudioApi).headAudioStreamByContainer(r as never)
    },
    {
        name: 'GetVideoStream',
        api: 'video',
        call: (a: never, r) =>
            (a as unknown as VideoApi).getVideoStream(r as never)
    },
    {
        name: 'HeadVideoStream',
        api: 'video',
        call: (a: never, r) =>
            (a as unknown as VideoApi).headVideoStream(r as never)
    },
    {
        name: 'GetVideoStreamByContainer',
        api: 'video',
        extra: { container: 'mp4' },
        call: (a: never, r) =>
            (a as unknown as VideoApi).getVideoStreamByContainer(r as never)
    },
    {
        name: 'HeadVideoStreamByContainer',
        api: 'video',
        extra: { container: 'mp4' },
        call: (a: never, r) =>
            (a as unknown as VideoApi).headVideoStreamByContainer(r as never)
    }
];

describe('deepObject/explode:true query serialization', () => {
    it.each(DEEP_OBJECT_SITES)(
        '$name serializes streamOptions as streamOptions[key]=value',
        async (site) => {
            const { axios, lastUrl } = captureUrl();
            const api =
                site.api === 'audio'
                    ? new AudioApi(configuration, BASE, axios)
                    : new VideoApi(configuration, BASE, axios);

            await site.call(api as never, {
                itemId: '11111111-2222-3333-4444-555555555555',
                ...(site.extra ?? {}),
                streamOptions: { foo: 'bar', baz: 'qux' }
            });

            const url = lastUrl();
            const params = url.searchParams;

            // What the contract names.
            expect(params.get('streamOptions[foo]')).toBe('bar');
            expect(params.get('streamOptions[baz]')).toBe('qux');

            // And, spelled as the raw query string, the URL-equivalent of
            // `streamOptions[foo]=bar&streamOptions[baz]=qux`.
            const decoded = decodeURIComponent(url.search);
            expect(decoded).toContain('streamOptions[foo]=bar');
            expect(decoded).toContain('streamOptions[baz]=qux');

            // The prefix-less expansion the stock template produced. This is the regression.
            expect(params.has('foo')).toBe(false);
            expect(params.has('baz')).toBe(false);

            // The form/explode:false reading, which this server binds to an EMPTY map.
            expect(params.has('streamOptions')).toBe(false);
            expect(decoded).not.toContain('streamOptions=foo,bar');
        }
    );

    it('does not disturb ordinary scalar query serialization', async () => {
        const { axios, lastUrl } = captureUrl();
        const api = new AudioApi(configuration, BASE, axios);

        await api.getAudioStream({
            itemId: '11111111-2222-3333-4444-555555555555',
            container: 'mp3',
            audioBitRate: 320,
            _static: true,
            streamOptions: { foo: 'bar' }
        } as never);

        const params = lastUrl().searchParams;
        expect(params.get('container')).toBe('mp3');
        expect(params.get('audioBitRate')).toBe('320');
        expect(params.get('static')).toBe('true');
        // …while the deepObject parameter beside them is still prefixed.
        expect(params.get('streamOptions[foo]')).toBe('bar');
    });

    it('does not disturb ordinary array query serialization', async () => {
        const { axios, lastUrl } = captureUrl();
        const api = new ArtistApi(configuration, BASE, axios);

        await api.getArtists({ genres: ['rock', 'jazz'] } as never);

        const url = lastUrl();
        // Arrays are emitted as repeated keys, unchanged by the deepObject override.
        expect(url.searchParams.getAll('genres')).toEqual(['rock', 'jazz']);
        expect(decodeURIComponent(url.search)).not.toContain('genres[0]');
    });

    it('omits streamOptions entirely when it is not supplied', async () => {
        const { axios, lastUrl } = captureUrl();
        const api = new AudioApi(configuration, BASE, axios);

        await api.getAudioStream({
            itemId: '11111111-2222-3333-4444-555555555555'
        } as never);

        const decoded = decodeURIComponent(lastUrl().search);
        expect(decoded).not.toContain('streamOptions');
    });

    it('percent-encodes reserved characters inside a deepObject key and value', async () => {
        const { axios, lastUrl } = captureUrl();
        const api = new AudioApi(configuration, BASE, axios);

        await api.getAudioStream({
            itemId: '11111111-2222-3333-4444-555555555555',
            streamOptions: { 'a b': 'c&d' }
        } as never);

        const url = lastUrl();
        expect(url.searchParams.get('streamOptions[a b]')).toBe('c&d');
        // The raw query must not carry a bare `&` inside the value.
        expect(url.search).toContain('c%26d');
    });
});
