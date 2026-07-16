import { decode } from 'blurhash';

self.onmessage = ({ data: { hash, width, height } }): void => {
    try {
        self.postMessage({
            pixels: decode(hash, width, height),
            hsh: hash,
            width: width,
            height: height
        });
    } catch {
        throw new TypeError(`Blurhash ${hash} is not valid`);
    }
};
